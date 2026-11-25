import { ProviderInstanceId } from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { expect } from "vite-plus/test";

import { LlamaSwapUnloadError, type LlamaSwapService } from "./LlamaSwapService.ts";
import { makeLlamaSwapRpc } from "./llamaSwapRpc.ts";

const id = ProviderInstanceId.make("claude-local");

const instances = (endpoint: string | undefined, environment: Array<[string, string]> = []) =>
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
                getSnapshot: Effect.succeed({ auth: { status: "authenticated", endpoint } }),
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
        makeLlamaSwapRpc(instances("http://h"), swap(calls)).unload({
          instanceId: ProviderInstanceId.make("other"),
          model: "m",
        }),
      );
      expect(unknown.message).toBe("Unknown provider instance.");
      const none = yield* Effect.flip(
        makeLlamaSwapRpc(instances(undefined), swap(calls)).unload({ instanceId: id, model: "m" }),
      );
      expect(none.message).toBe("This provider instance does not use a custom endpoint.");
      const rejected = yield* Effect.flip(
        makeLlamaSwapRpc(instances("http://h"), swap(calls)).unload({
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
    const first = yield* makeLlamaSwapRpc(instances("http://h:1"), swap(calls))
      .subscribe({ instanceId: id })
      .pipe(Stream.take(1), Stream.runCollect);
    expect(first).toEqual([status]);
  }),
);
