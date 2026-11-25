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

type Instances = ProviderInstanceRegistry.ProviderInstanceRegistry["Service"];

/**
 * The endpoint comes from the instance's own provider config, never from the client. Codex's
 * `env_key` is not read yet, so a Codex instance sets `LLAMA_SWAP_API_KEY` in its environment.
 */
const resolveInstanceEndpoint = Effect.fn("LlamaSwapRpc.resolveInstanceEndpoint")(function* (
  instances: Instances,
  instanceId: ProviderInstanceId,
) {
  const instance = yield* instances.getInstance(instanceId);
  if (!instance) {
    return yield* new LlamaSwapError({ instanceId, detail: "Unknown provider instance." });
  }
  const snapshot = yield* instance.snapshot.getSnapshot;
  const origin = snapshot.auth.endpoint && normalizeLlamaSwapOrigin(snapshot.auth.endpoint);
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
  readThreads: Effect.Effect<
    ReadonlyArray<SweepThread & { readonly instanceId: ProviderInstanceId }>
  >,
) => ({
  /** Re-reads once a second and emits only when something changed. */
  subscribe: (input: { readonly instanceId: ProviderInstanceId }) =>
    Stream.unwrap(
      resolveInstanceEndpoint(instances, input.instanceId).pipe(
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
      const all = yield* instances.listInstances;
      const endpoints = new Map<ProviderInstanceId, LlamaSwapEndpoint>();
      for (const instance of all) {
        const endpoint = yield* resolveInstanceEndpoint(instances, instance.instanceId).pipe(
          Effect.option,
        );
        if (Option.isSome(endpoint)) endpoints.set(instance.instanceId, endpoint.value);
      }
      if (endpoints.size === 0) return [];
      const statusByOrigin = new Map<string, LlamaSwapStatus>();
      const statusByInstance = new Map<string, LlamaSwapStatus>();
      for (const [instanceId, endpoint] of endpoints) {
        let status = statusByOrigin.get(endpoint.origin);
        if (!status) {
          status = yield* llamaSwap.status(endpoint);
          statusByOrigin.set(endpoint.origin, status);
        }
        statusByInstance.set(instanceId, status);
      }
      const threads = (yield* readThreads).filter((thread) => endpoints.has(thread.instanceId));
      return sweepSwappedOut({ threads, statusByInstance, notified });
    });
    return Stream.fromEffectSchedule(sweep, Schedule.spaced(SWEEP_INTERVAL)).pipe(
      Stream.filter((events) => events.length > 0),
    );
  }),
  unload: Effect.fn("LlamaSwapRpc.unload")(function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly model: string;
  }) {
    const endpoint = yield* resolveInstanceEndpoint(instances, input.instanceId);
    yield* llamaSwap
      .unload(endpoint, input.model)
      .pipe(
        Effect.mapError(
          (error) => new LlamaSwapError({ instanceId: input.instanceId, detail: error.message }),
        ),
      );
  }),
});
