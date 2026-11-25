import { it as effectIt } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { expect } from "vite-plus/test";

import * as LlamaSwap from "./LlamaSwapService.ts";

const endpoint = { origin: "http://llama.test:8080", apiKey: "sk-test" };

const serviceWith = (client: HttpClient.HttpClient) =>
  LlamaSwap.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));

const respond = (request: Parameters<typeof HttpClientResponse.fromWeb>[0], response: Response) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, response));

effectIt.effect(
  "reads what is loaded, with context from the launch command and the listing",
  () => {
    const seen: Array<string> = [];
    const client = HttpClient.make((request) => {
      seen.push(`${request.method} ${request.url} ${request.headers.authorization}`);
      if (request.url.endsWith("/running")) {
        return respond(
          request,
          Response.json({
            running: [
              { model: "qwen", state: "ready", cmd: "llama-server --fit-ctx 16384 -np 2" },
              { model: "gemma", state: "ready", cmd: "llama-server" },
            ],
          }),
        );
      }
      return respond(
        request,
        Response.json({
          data: [
            { id: "qwen", context_length: 99999 },
            { id: "gemma", context_length: 8192 },
            { id: "idle" },
          ],
        }),
      );
    });
    return Effect.gen(function* () {
      const service = yield* LlamaSwap.LlamaSwapService;
      const status = yield* service.status(endpoint);
      expect(status).toMatchObject({ supported: true, authFailed: false });
      expect(status.running).toEqual([
        { model: "qwen", state: "ready", contextTokens: 16384, slots: 2 },
        { model: "gemma", state: "ready", contextTokens: 8192, slots: 1 },
      ]);
      expect(status.models.map((model) => model.id)).toEqual(["qwen", "gemma", "idle"]);
      // One Bearer header on every call, and /props is never read.
      expect(seen).toEqual([
        "GET http://llama.test:8080/running Bearer sk-test",
        "GET http://llama.test:8080/v1/models Bearer sk-test",
      ]);
    }).pipe(Effect.provide(serviceWith(client)));
  },
);

effectIt.effect("falls back to the endpoint's default context when the server reports none", () => {
  const client = HttpClient.make((request) =>
    request.url.endsWith("/running")
      ? respond(
          request,
          Response.json({ running: [{ model: "gemma", state: "ready", cmd: "llama-server" }] }),
        )
      : respond(
          request,
          Response.json({
            data: [{ id: "gemma" }, { id: "idle" }, { id: "big", context_length: 4096 }],
          }),
        ),
  );
  return Effect.gen(function* () {
    const status = yield* (yield* LlamaSwap.LlamaSwapService).status({
      ...endpoint,
      defaultContextTokens: 65536,
    });
    expect(status.models).toEqual([
      { id: "gemma", contextTokens: 65536 },
      { id: "idle", contextTokens: 65536 },
      { id: "big", contextTokens: 4096 },
    ]);
    expect(status.running).toEqual([
      { model: "gemma", state: "ready", contextTokens: 65536, slots: 1 },
    ]);
  }).pipe(Effect.provide(serviceWith(client)));
});

effectIt.effect("reads a plain OpenAI-compatible server as unsupported", () => {
  const client = HttpClient.make((request) =>
    respond(request, new Response("no", { status: 404 })),
  );
  return Effect.gen(function* () {
    const status = yield* (yield* LlamaSwap.LlamaSwapService).status(endpoint);
    expect(status).toEqual({ supported: false, authFailed: false, running: [], models: [] });
  }).pipe(Effect.provide(serviceWith(client)));
});

effectIt.effect("reports a rejected API key instead of looking like another server", () => {
  const client = HttpClient.make((request) => respond(request, new Response("", { status: 401 })));
  return Effect.gen(function* () {
    const status = yield* (yield* LlamaSwap.LlamaSwapService).status(endpoint);
    expect(status).toEqual({ supported: false, authFailed: true, running: [], models: [] });
  }).pipe(Effect.provide(serviceWith(client)));
});

effectIt.effect("reads an unreachable endpoint as unsupported", () => {
  const client = HttpClient.make((request) =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ request, description: "connection refused" }),
      }),
    ),
  );
  return Effect.gen(function* () {
    const status = yield* (yield* LlamaSwap.LlamaSwapService).status(endpoint);
    expect(status.supported).toBe(false);
  }).pipe(Effect.provide(serviceWith(client)));
});

effectIt.effect("unloads one model by its encoded id", () => {
  const seen: Array<string> = [];
  const client = HttpClient.make((request) => {
    seen.push(`${request.method} ${request.url}`);
    return respond(request, Response.json({ msg: "ok" }));
  });
  return Effect.gen(function* () {
    yield* (yield* LlamaSwap.LlamaSwapService).unload(endpoint, "org/qwen 3");
    expect(seen).toEqual(["POST http://llama.test:8080/api/models/unload/org%2Fqwen%203"]);
  }).pipe(Effect.provide(serviceWith(client)));
});

effectIt.effect("fails an unload llama-swap refuses, naming a rejected key", () => {
  const client = HttpClient.make((request) => respond(request, new Response("", { status: 401 })));
  return Effect.gen(function* () {
    const error = yield* Effect.flip((yield* LlamaSwap.LlamaSwapService).unload(endpoint, "qwen"));
    expect(error).toMatchObject({ _tag: "LlamaSwapUnloadError", status: 401 });
    expect(error.message).toBe("llama-swap rejected the API key.");
  }).pipe(Effect.provide(serviceWith(client)));
});

effectIt.effect("opens one shared log stream per origin", () =>
  Effect.gen(function* () {
    const opened = yield* Deferred.make<string>();
    let eventRequests = 0;
    const client = HttpClient.make((request) => {
      eventRequests += 1;
      // A stream that never ends, like the real one.
      const body = new ReadableStream<Uint8Array>({ start() {} });
      return Deferred.succeed(opened, String(request.headers.authorization)).pipe(
        Effect.andThen(respond(request, new Response(body, { status: 200 }))),
      );
    });
    yield* Effect.gen(function* () {
      const service = yield* LlamaSwap.LlamaSwapService;
      expect(yield* service.latestLogLine(endpoint)).toEqual(Option.none());
      expect(yield* Deferred.await(opened)).toBe("Bearer sk-test");
      expect(yield* service.latestLogLine(endpoint)).toEqual(Option.none());
      expect(eventRequests).toBe(1);
    }).pipe(Effect.provide(serviceWith(client)));
  }),
);

effectIt.effect("sends the key in the endpoint's own header and no other", () => {
  const seen: Array<Record<string, string>> = [];
  const client = HttpClient.make((request) => {
    seen.push({ ...request.headers });
    return respond(request, new Response("no", { status: 404 }));
  });
  return Effect.gen(function* () {
    const service = yield* LlamaSwap.LlamaSwapService;
    yield* service.status({ origin: "http://azure.test", apiKey: "k", authHeader: "api-key" });
    expect(seen[0]?.["api-key"]).toBe("k");
    expect(seen[0]?.authorization).toBeUndefined();
  }).pipe(Effect.provide(serviceWith(client)));
});
