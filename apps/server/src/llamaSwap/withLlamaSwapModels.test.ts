import { it as effectIt } from "@effect/vitest";
import type { ServerProviderDraft } from "@t3tools/provider-core/server/snapshotProbe";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { expect } from "vite-plus/test";

import { withLlamaSwapModels } from "./withLlamaSwapModels.ts";

const draft = (endpoint: string | undefined) =>
  ({
    auth: { status: "authenticated", ...(endpoint ? { endpoint } : {}) },
    models: [{ slug: "qwen", name: "Qwen", isCustom: false, capabilities: null }],
  }) as unknown as ServerProviderDraft;

const client = (calls: Array<string>, supported = true) =>
  HttpClient.make((request) => {
    calls.push(`${request.url} ${request.headers.authorization}`);
    const body = request.url.endsWith("/running")
      ? supported
        ? { running: [] }
        : {}
      : { data: [{ id: "qwen" }, { id: "gemma" }] };
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json(body, { status: supported ? 200 : 404 })),
    );
  });

effectIt.effect("adds only the llama-swap models Codex does not list", () =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    const result = yield* withLlamaSwapModels(draft("http://swap:8080"), client(calls), {
      LLAMA_SWAP_API_KEY: "k",
    });
    expect(result.models.map((model) => [model.slug, model.isCustom])).toEqual([
      ["qwen", false],
      ["gemma", true],
    ]);
    expect(calls[0]).toBe("http://swap:8080/running Bearer k");
  }),
);

effectIt.effect("leaves the draft alone without an endpoint or off llama-swap", () =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    const plain = draft(undefined);
    expect(yield* withLlamaSwapModels(plain, client(calls), {})).toBe(plain);
    expect(calls).toEqual([]);
    const other = draft("http://x:1");
    expect(yield* withLlamaSwapModels(other, client(calls, false), {})).toBe(other);
  }),
);
