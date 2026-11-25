import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";

import {
  authHeaderFor,
  consumeLogChunk,
  type LlamaSwapAuthHeader,
  type LlamaSwapListedModel,
  type LlamaSwapRunningModel,
  parseModelList,
  parseRunning,
  withListedContext,
} from "./llamaSwapProtocol.ts";

/** An origin from the user's own provider config, never one a client names. */
export interface LlamaSwapEndpoint {
  readonly origin: string;
  readonly apiKey?: string | undefined;
  /** How the key is sent. Bearer when unset. */
  readonly authHeader?: LlamaSwapAuthHeader | undefined;
  /** The model's whole window, for a model whose size the server cannot report. */
  readonly defaultContextTokens?: number | undefined;
}

export interface LlamaSwapStatus {
  /** True only when `GET /running` answered with llama-swap's own shape. */
  readonly supported: boolean;
  /** llama-swap answered 401 or 403, so its `apiKeys` rejected ours. */
  readonly authFailed: boolean;
  readonly running: ReadonlyArray<LlamaSwapRunningModel>;
  readonly models: ReadonlyArray<LlamaSwapListedModel>;
}

export class LlamaSwapUnloadError extends Schema.TaggedError<LlamaSwapUnloadError>()(
  "LlamaSwapUnloadError",
  {
    status: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.status === 401 || this.status === 403
      ? "llama-swap rejected the API key."
      : "llama-swap could not unload the model.";
  }
}

export class LlamaSwapService extends Context.Service<
  LlamaSwapService,
  {
    /** Never fails: an unreachable or non-llama-swap endpoint reads as unsupported. */
    readonly status: (endpoint: LlamaSwapEndpoint) => Effect.Effect<LlamaSwapStatus>;
    readonly unload: (
      endpoint: LlamaSwapEndpoint,
      model: string,
    ) => Effect.Effect<void, LlamaSwapUnloadError>;
    /** Newest llama.cpp stdout line seen while a model loads, via one shared stream per origin. */
    readonly latestLogLine: (endpoint: LlamaSwapEndpoint) => Effect.Effect<Option.Option<string>>;
  }
>()("t3/llamaSwap/LlamaSwapService") {}

const REQUEST_TIMEOUT = "5 seconds";
// llama-swap answers an unload once the backend process has stopped.
const UNLOAD_TIMEOUT = "30 seconds";
const TAIL_IDLE_MS = 30_000;
const TAIL_SWEEP_INTERVAL = "20 seconds";

type JsonResult =
  | { readonly _tag: "ok"; readonly body: unknown }
  | { readonly _tag: "authFailed" }
  | { readonly _tag: "failed" };

const FAILED: JsonResult = { _tag: "failed" };

const request = (
  endpoint: LlamaSwapEndpoint,
  method: "GET" | "POST",
  path: string,
): HttpClientRequest.HttpClientRequest => {
  const base = `${endpoint.origin}${path}`;
  const req = method === "GET" ? HttpClientRequest.get(base) : HttpClientRequest.post(base);
  // One header only: a request carrying both Bearer and x-api-key hung against llama-swap.
  if (!endpoint.apiKey) return req;
  const header = authHeaderFor(endpoint.authHeader ?? "authorization-bearer", endpoint.apiKey);
  return HttpClientRequest.setHeader(req, header.name, header.value);
};

const getJson = (
  client: HttpClient.HttpClient,
  endpoint: LlamaSwapEndpoint,
  path: string,
): Effect.Effect<JsonResult> =>
  client.execute(request(endpoint, "GET", path)).pipe(
    Effect.flatMap((response): Effect.Effect<JsonResult, unknown> =>
      response.status === 401 || response.status === 403
        ? Effect.succeed({ _tag: "authFailed" })
        : response.status >= 200 && response.status < 300
          ? response.json.pipe(Effect.map((body): JsonResult => ({ _tag: "ok", body })))
          : Effect.succeed(FAILED),
    ),
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.orElseSucceed(() => FAILED),
  );

export const fetchLlamaSwapStatus = Effect.fn("LlamaSwapService.status")(function* (
  client: HttpClient.HttpClient,
  endpoint: LlamaSwapEndpoint,
): Effect.fn.Return<LlamaSwapStatus> {
  const running = yield* getJson(client, endpoint, "/running");
  if (running._tag === "authFailed") {
    return { supported: false, authFailed: true, running: [], models: [] };
  }
  const parsed = running._tag === "ok" ? parseRunning(running.body) : undefined;
  if (!parsed) return { supported: false, authFailed: false, running: [], models: [] };
  const listing = yield* getJson(client, endpoint, "/v1/models");
  const listed = listing._tag === "ok" ? parseModelList(listing.body) : [];
  const fallback = endpoint.defaultContextTokens;
  const models =
    fallback === undefined
      ? listed
      : listed.map((model) =>
          model.contextTokens === undefined ? { ...model, contextTokens: fallback } : model,
        );
  return {
    supported: true,
    authFailed: false,
    running: withListedContext(parsed, models),
    models,
  };
});

interface LogTail {
  latestLine: string | undefined;
  lastAccessedMs: number;
  fiber: Fiber.Fiber<void> | undefined;
}

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const scope = yield* Effect.scope;
  const tails = new Map<string, LogTail>();
  const status: LlamaSwapService["Service"]["status"] = (endpoint) =>
    fetchLlamaSwapStatus(client, endpoint);

  const unload: LlamaSwapService["Service"]["unload"] = Effect.fn("LlamaSwapService.unload")(
    function* (endpoint, model) {
      const response = yield* client
        .execute(request(endpoint, "POST", `/api/models/unload/${encodeURIComponent(model)}`))
        .pipe(
          Effect.timeout(UNLOAD_TIMEOUT),
          Effect.mapError((cause) => new LlamaSwapUnloadError({ cause })),
        );
      if (response.status < 200 || response.status >= 300) {
        return yield* new LlamaSwapUnloadError({ status: response.status });
      }
    },
  );

  const pump = Effect.fn("LlamaSwapService.pump")(
    function* (endpoint: LlamaSwapEndpoint, tail: LogTail) {
      const response = yield* client.execute(request(endpoint, "GET", "/api/events"));
      if (response.status !== 200) return;
      let buffer = "";
      yield* response.stream.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            const next = consumeLogChunk(buffer, chunk);
            buffer = next.buffer;
            if (next.latestLine !== undefined) tail.latestLine = next.latestLine;
          }),
        ),
      );
    },
    // A dropped connection ends the tail; the next access starts a fresh one.
    (effect, endpoint, tail) =>
      effect.pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            // Delete by identity: a newer tail for the same origin must survive an old pump ending.
            if (tails.get(endpoint.origin) === tail) tails.delete(endpoint.origin);
          }),
        ),
      ),
  );

  const latestLogLine: LlamaSwapService["Service"]["latestLogLine"] = Effect.fn(
    "LlamaSwapService.latestLogLine",
  )(function* (endpoint) {
    const now = yield* Clock.currentTimeMillis;
    let tail = tails.get(endpoint.origin);
    if (!tail) {
      const created: LogTail = { latestLine: undefined, lastAccessedMs: now, fiber: undefined };
      tails.set(endpoint.origin, created);
      created.fiber = yield* pump(endpoint, created).pipe(Effect.forkIn(scope));
      tail = created;
    }
    tail.lastAccessedMs = now;
    return Option.fromNullishOr(tail.latestLine);
  });

  yield* Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const [origin, tail] of tails) {
      if (now - tail.lastAccessedMs < TAIL_IDLE_MS) continue;
      tails.delete(origin);
      if (tail.fiber) yield* Fiber.interrupt(tail.fiber);
    }
  }).pipe(Effect.andThen(Effect.sleep(TAIL_SWEEP_INTERVAL)), Effect.forever, Effect.forkIn(scope));

  return LlamaSwapService.of({ status, unload, latestLogLine });
});

export const layer = Layer.effect(LlamaSwapService, make);
