import { LlamaSwapError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import type * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { LlamaSwapEndpoint, LlamaSwapService, LlamaSwapStatus } from "./LlamaSwapService.ts";
import { normalizeLlamaSwapOrigin, resolveLlamaSwapApiKey } from "./llamaSwapProtocol.ts";
import { sweepSwappedOut, type SweepThread } from "./swapSweep.ts";

const POLL_INTERVAL = "1 second";
const SWEEP_INTERVAL = "20 seconds";

export type CustomEndpointLookup = (
  instanceId: ProviderInstanceId,
) => Effect.Effect<LlamaSwapEndpoint | undefined>;

type Instances = ProviderInstanceRegistry.ProviderInstanceRegistry["Service"];

/**
 * The endpoint comes from the instance's own provider config, never from the client. Codex's
 * `env_key` is not read yet, so a Codex instance sets `LLAMA_SWAP_API_KEY` in its environment.
 */
const resolveInstanceEndpoint = Effect.fn("LlamaSwapRpc.resolveInstanceEndpoint")(function* (
  instances: Instances,
  customEndpoint: CustomEndpointLookup,
  instanceId: ProviderInstanceId,
  subProvider?: string,
) {
  // A saved endpoint answers for the whole instance, unless an upstream provider names its own.
  const saved = yield* customEndpoint(instanceId);
  if (saved && subProvider === undefined) return saved;
  const instance = yield* instances.getInstance(instanceId);
  if (!instance) {
    return yield* new LlamaSwapError({ instanceId, detail: "Unknown provider instance." });
  }
  const snapshot = yield* instance.snapshot.getSnapshot;
  const configured =
    subProvider === undefined
      ? snapshot.auth.endpoint
      : snapshot.subProviderEndpoints?.[subProvider];
  const origin = configured && normalizeLlamaSwapOrigin(configured);
  if (!origin) {
    return yield* new LlamaSwapError({
      instanceId,
      detail: "This provider instance does not use a custom endpoint.",
    });
  }
  const environment = Object.fromEntries(
    (instance.environment ?? []).map((variable) => [variable.name, variable.value]),
  );
  const apiKey = resolveLlamaSwapApiKey(environment);
  return { origin, ...(apiKey ? { apiKey } : {}) } satisfies LlamaSwapEndpoint;
});

export const makeLlamaSwapRpc = (
  instances: Instances,
  llamaSwap: LlamaSwapService["Service"],
  /** Live threads with a provider session, which a swap-out could interrupt. */
  customEndpoint: CustomEndpointLookup,
  readThreads: Effect.Effect<
    ReadonlyArray<{
      readonly id: SweepThread["id"];
      readonly projectId: SweepThread["projectId"];
      readonly instanceId: ProviderInstanceId;
      readonly model: string;
    }>
  >,
) => ({
  /** Re-reads once a second and emits only when something changed. */
  subscribe: (input: {
    readonly instanceId: ProviderInstanceId;
    readonly subProvider?: string | undefined;
  }) =>
    Stream.unwrap(
      resolveInstanceEndpoint(instances, customEndpoint, input.instanceId, input.subProvider).pipe(
        Effect.map((endpoint) =>
          Stream.fromEffectSchedule(
            Effect.gen(function* () {
              const status = yield* llamaSwap.status(endpoint);
              const loading = status.running.some(
                (model) => model.state === "starting" || model.state === "stopping",
              );
              const logLine = loading
                ? Option.getOrUndefined(yield* llamaSwap.latestLogLine(endpoint))
                : undefined;
              return { ...status, ...(logLine !== undefined ? { logLine } : {}) };
            }),
            Schedule.spaced(POLL_INTERVAL),
          ).pipe(Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b))),
        ),
      ),
    ),
  /**
   * Every 20 seconds, while a client listens, reports threads whose model another client
   * displaced. Nothing is read when no instance has a custom endpoint.
   */
  swapEvents: Stream.suspend(() => {
    const notified = new Set<string>();
    const sweep = Effect.gen(function* () {
      let anyEndpoint = false;
      for (const instance of yield* instances.listInstances) {
        const snapshot = yield* instance.snapshot.getSnapshot;
        anyEndpoint ||= Boolean(snapshot.auth.endpoint || snapshot.subProviderEndpoints);
      }
      if (!anyEndpoint) return [];
      // OpenCode and Pi prefix a slug with the upstream provider, which owns the endpoint.
      const located = new Map<
        string,
        Option.Option<{ endpoint: LlamaSwapEndpoint; model: string }>
      >();
      const locate = Effect.fn("LlamaSwapRpc.locate")(function* (
        instanceId: ProviderInstanceId,
        model: string,
      ) {
        const slash = model.indexOf("/");
        const key = `${instanceId}\0${slash < 0 ? "" : model.slice(0, slash)}`;
        const known = located.get(key);
        if (known) return known;
        const viaProvider =
          slash < 0
            ? Option.none()
            : yield* resolveInstanceEndpoint(
                instances,
                customEndpoint,
                instanceId,
                model.slice(0, slash),
              ).pipe(Effect.option);
        const found = Option.isSome(viaProvider)
          ? Option.some({ endpoint: viaProvider.value, model: model.slice(slash + 1) })
          : (yield* resolveInstanceEndpoint(instances, customEndpoint, instanceId).pipe(
              Effect.option,
            )).pipe(Option.map((endpoint) => ({ endpoint, model })));
        located.set(key, found);
        return found;
      });
      const threads: Array<SweepThread> = [];
      const endpointByOrigin = new Map<string, LlamaSwapEndpoint>();
      for (const thread of yield* readThreads) {
        const place = yield* locate(thread.instanceId, thread.model);
        if (Option.isNone(place)) continue;
        endpointByOrigin.set(place.value.endpoint.origin, place.value.endpoint);
        threads.push({
          id: thread.id,
          projectId: thread.projectId,
          origin: place.value.endpoint.origin,
          model: place.value.model,
        });
      }
      if (threads.length === 0) return [];
      const statusByOrigin = new Map<string, LlamaSwapStatus>();
      for (const [origin, endpoint] of endpointByOrigin) {
        statusByOrigin.set(origin, yield* llamaSwap.status(endpoint));
      }
      return sweepSwappedOut({ threads, statusByOrigin, notified });
    });
    return Stream.fromEffectSchedule(sweep, Schedule.spaced(SWEEP_INTERVAL)).pipe(
      Stream.filter((events) => events.length > 0),
    );
  }),
  unload: Effect.fn("LlamaSwapRpc.unload")(function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly subProvider?: string | undefined;
    readonly model: string;
  }) {
    const endpoint = yield* resolveInstanceEndpoint(
      instances,
      customEndpoint,
      input.instanceId,
      input.subProvider,
    );
    yield* llamaSwap
      .unload(endpoint, input.model)
      .pipe(
        Effect.mapError(
          (error) => new LlamaSwapError({ instanceId: input.instanceId, detail: error.message }),
        ),
      );
  }),
});
