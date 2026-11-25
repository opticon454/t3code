import { ProviderInstanceId } from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { expect } from "vite-plus/test";

import { LlamaSwapUnloadError, type LlamaSwapService } from "./LlamaSwapService.ts";
import { makeLlamaSwapRpc } from "./llamaSwapRpc.ts";

const id = ProviderInstanceId.make("claude-local");
const noSaved = () => Effect.undefined;

const instances = (
  endpoint: string | undefined,
  environment: Array<[string, string]> = [],
  subProviderEndpoints?: Record<string, string>,
) =>
  ({
    getInstance: (requested: ProviderInstanceId) =>
      Effect.succeed(
        requested === id
          ? {
              environment: environment.map(([name, value]) => ({
                name,
                value,
                sensitive: true,
              })),
              snapshot: {
                getSnapshot: Effect.succeed({
                  auth: { status: "authenticated", endpoint },
                  ...(subProviderEndpoints ? { subProviderEndpoints } : {}),
                }),
              },
            }
          : undefined,
      ),
  }) as never;

const status = { supported: true, authFailed: false, running: [], models: [] };

const swap = (calls: Array<unknown>): LlamaSwapService["Service"] => ({
  status: (endpoint) => Effect.sync(() => (calls.push(["status", endpoint]), status)),
  unload: (endpoint, model) =>
    model === "bad"
      ? Effect.fail(new LlamaSwapUnloadError({ status: 401 }))
      : Effect.sync(() => void calls.push(["unload", endpoint, model])),
  latestLogLine: () => Effect.succeedNone,
});

effectIt.effect("unloads on the instance's own endpoint with its configured key", () =>
  Effect.gen(function* () {
    const calls: Array<unknown> = [];
    const rpc = makeLlamaSwapRpc(
      instances("http://10.0.0.5:8080/v1", [["ANTHROPIC_AUTH_TOKEN", "sk-1"]]),
      swap(calls),
      noSaved,
      Effect.succeed([]),
    );
    yield* rpc.unload({ instanceId: id, model: "qwen" });
    expect(calls).toEqual([["unload", { origin: "http://10.0.0.5:8080", apiKey: "sk-1" }, "qwen"]]);
  }),
);

effectIt.effect(
  "refuses an unknown instance, one with no custom endpoint, and a rejected key",
  () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const unknown = yield* Effect.flip(
        makeLlamaSwapRpc(instances("http://h"), swap(calls), noSaved, Effect.succeed([])).unload({
          instanceId: ProviderInstanceId.make("other"),
          model: "m",
        }),
      );
      expect(unknown.message).toBe("Unknown provider instance.");
      const none = yield* Effect.flip(
        makeLlamaSwapRpc(instances(undefined), swap(calls), noSaved, Effect.succeed([])).unload({
          instanceId: id,
          model: "m",
        }),
      );
      expect(none.message).toBe("This provider instance does not use a custom endpoint.");
      const rejected = yield* Effect.flip(
        makeLlamaSwapRpc(instances("http://h"), swap(calls), noSaved, Effect.succeed([])).unload({
          instanceId: id,
          model: "bad",
        }),
      );
      expect(rejected.message).toBe("llama-swap rejected the API key.");
      expect(calls).toEqual([]);
    }),
);

effectIt.effect("subscribe emits the status once while it is unchanged", () =>
  Effect.gen(function* () {
    const calls: Array<unknown> = [];
    const first = yield* makeLlamaSwapRpc(
      instances("http://h:1"),
      swap(calls),
      noSaved,
      Effect.succeed([]),
    )
      .subscribe({ instanceId: id })
      .pipe(Stream.take(1), Stream.runCollect);
    expect(first).toEqual([status]);
  }),
);

effectIt.live("swapEvents stays silent when no instance has a custom endpoint", () =>
  Effect.gen(function* () {
    const calls: Array<unknown> = [];
    const events = yield* makeLlamaSwapRpc(
      {
        getInstance: () => Effect.undefined,
        listInstances: Effect.succeed([
          {
            instanceId: id,
            snapshot: { getSnapshot: Effect.succeed({ auth: { status: "unknown" } }) },
          },
        ]),
      } as never,
      swap(calls),
      noSaved,
      Effect.succeed([]),
    ).swapEvents.pipe(Stream.take(1), Stream.runCollect, Effect.timeoutOption("50 millis"));
    expect(events).toEqual(Option.none());
    expect(calls).toEqual([]);
  }),
);

effectIt.live("swapEvents reports each thread with its own model", () =>
  Effect.gen(function* () {
    const base = instances("http://10.0.0.5:8080/v1");
    const withList = {
      getInstance: (requested: ProviderInstanceId) =>
        (base as { getInstance: (id: ProviderInstanceId) => never }).getInstance(requested),
      listInstances: Effect.succeed([
        {
          instanceId: id,
          snapshot: {
            getSnapshot: Effect.succeed({
              auth: { status: "authenticated", endpoint: "http://10.0.0.5:8080/v1" },
            }),
          },
        },
      ]),
    } as never;
    const loaded = {
      supported: true,
      authFailed: false,
      running: [{ model: "gpt", state: "ready" as const }],
      models: [{ id: "qwen" }, { id: "llama" }, { id: "gpt" }],
    };
    const service: LlamaSwapService["Service"] = {
      ...swap([]),
      status: () => Effect.succeed(loaded),
    };
    const thread = (threadId: string, model: string) => ({
      id: threadId as never,
      projectId: "project" as never,
      instanceId: id,
      model,
    });
    const [events] = yield* makeLlamaSwapRpc(
      withList,
      service,
      noSaved,
      Effect.succeed([thread("a", "qwen"), thread("b", "llama")]),
    ).swapEvents.pipe(Stream.take(1), Stream.runCollect);
    expect(
      events?.map((event) => [event.threadId, event.previousModel, event.loadedModel]),
    ).toEqual([
      ["a", "qwen", "gpt"],
      ["b", "llama", "gpt"],
    ]);
  }),
);

effectIt.effect("unloads on the endpoint of the named upstream provider", () =>
  Effect.gen(function* () {
    const calls: Array<unknown> = [];
    const rpc = makeLlamaSwapRpc(
      instances(undefined, [["LLAMA_SWAP_API_KEY", "k"]], { swap: "http://10.0.0.9:9292/v1" }),
      swap(calls),
      noSaved,
      Effect.succeed([]),
    );
    yield* rpc.unload({ instanceId: id, subProvider: "swap", model: "qwen" });
    expect(calls).toEqual([["unload", { origin: "http://10.0.0.9:9292", apiKey: "k" }, "qwen"]]);
    const missing = yield* Effect.flip(
      rpc.unload({ instanceId: id, subProvider: "other", model: "qwen" }),
    );
    expect(missing.message).toBe("This provider instance does not use a custom endpoint.");
  }),
);

effectIt.effect("an upstream provider borrows the key saved for its address", () =>
  Effect.gen(function* () {
    const calls: Array<unknown> = [];
    const saved = {
      origin: "http://10.0.0.9:9292",
      apiKey: "saved-key",
      authHeader: "basic" as const,
    };
    const rpc = makeLlamaSwapRpc(
      instances(undefined, [], { swap: "http://10.0.0.9:9292/v1" }),
      swap(calls),
      (_instance, origin) => Effect.succeed(origin === saved.origin ? saved : undefined),
      Effect.succeed([]),
    );
    yield* rpc.unload({ instanceId: id, subProvider: "swap", model: "qwen" });
    expect(calls).toEqual([["unload", saved, "qwen"]]);
  }),
);

effectIt.effect("a saved endpoint answers for the instance, with its header style", () =>
  Effect.gen(function* () {
    const calls: Array<unknown> = [];
    const rpc = makeLlamaSwapRpc(
      instances(undefined),
      swap(calls),
      () =>
        Effect.succeed({ origin: "http://azure:1", apiKey: "k", authHeader: "api-key" as const }),
      Effect.succeed([]),
    );
    yield* rpc.unload({ instanceId: id, model: "qwen" });
    expect(calls).toEqual([
      ["unload", { origin: "http://azure:1", apiKey: "k", authHeader: "api-key" }, "qwen"],
    ]);
  }),
);
