/** Pure parsing for llama-swap's HTTP API. Ported from Codeman's custom-model-routes.ts. */

export type LlamaSwapModelState = "ready" | "starting" | "stopping" | "unknown";

export interface LlamaSwapRunningModel {
  readonly model: string;
  readonly state: LlamaSwapModelState;
  /** Total context from the launch command, else the listed figure (one slot). */
  readonly contextTokens?: number;
  readonly slots?: number;
}

export interface LlamaSwapListedModel {
  readonly id: string;
  /** llama-swap documents the listed figure as the per-slot window. */
  readonly contextTokens?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const positiveInt = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

/** An http(s) origin with no credentials, or undefined. */
export function normalizeLlamaSwapOrigin(value: string): string | undefined {
  const url = URL.parse(value.trim());
  if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
  return url.origin;
}

/**
 * The credential llama-swap's `apiKeys` expects. `LLAMA_SWAP_API_KEY` wins, then the credential
 * the provider already sends to that endpoint: a bearer or `x-api-key` variable, or a header
 * Claude's `ANTHROPIC_CUSTOM_HEADERS` carries (the `api-key` and Basic styles). `extraNames`
 * carries a name only the provider's config knows, such as Codex's `env_key`.
 */
export function resolveLlamaSwapCredential(
  environment: Readonly<Record<string, unknown>>,
  extraNames: ReadonlyArray<string> = [],
): { readonly apiKey: string; readonly authHeader?: LlamaSwapAuthHeader } | undefined {
  const text = (name: string) => {
    const value = environment[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  for (const name of [
    "LLAMA_SWAP_API_KEY",
    ...extraNames,
    "T3_ENDPOINT_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
  ]) {
    const apiKey = text(name);
    if (apiKey) return { apiKey };
  }
  for (const line of (text("ANTHROPIC_CUSTOM_HEADERS") ?? "").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!value) continue;
    if (name === "api-key" || name === "x-api-key") return { apiKey: value, authHeader: name };
    if (name === "authorization" && /^basic /i.test(value)) {
      const decoded = safeAtob(value.slice(6).trim());
      if (decoded !== undefined) return { apiKey: decoded, authHeader: "basic" };
    }
    if (name === "authorization" && /^bearer /i.test(value))
      return { apiKey: value.slice(7).trim() };
  }
  return undefined;
}

function safeAtob(value: string): string | undefined {
  try {
    return atob(value);
  } catch {
    return undefined;
  }
}

const normalizeState = (value: unknown): LlamaSwapModelState =>
  value === "ready" || value === "starting" || value === "stopping" ? value : "unknown";

/** Value of `--flag value` or `--flag=value` in a launch command. */
function flagValue(
  tokens: ReadonlyArray<string>,
  names: ReadonlyArray<string>,
): number | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    for (const name of names) {
      if (token === name) return positiveInt(tokens[i + 1]);
      if (token.startsWith(`${name}=`)) return positiveInt(token.slice(name.length + 1));
    }
  }
  return undefined;
}

/**
 * Context and slots from llama-swap's own launch command. `/props` is not used: for a
 * `--fit-ctx` backend it reported the trained maximum, not the configured window.
 */
export function parseLaunchCommand(cmd: string): { contextTokens?: number; slots?: number } {
  const tokens = cmd.split(/\s+/).filter(Boolean);
  const contextTokens = flagValue(tokens, ["--fit-ctx"]) ?? flagValue(tokens, ["-c", "--ctx-size"]);
  const slots = flagValue(tokens, ["-np", "--parallel"]);
  return {
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(slots !== undefined ? { slots } : {}),
  };
}

/** `GET /running`. Undefined unless the body has llama-swap's `{ running: [...] }` shape. */
export function parseRunning(body: unknown): ReadonlyArray<LlamaSwapRunningModel> | undefined {
  if (!isRecord(body) || !Array.isArray(body.running)) return undefined;
  return body.running.flatMap((entry): Array<LlamaSwapRunningModel> => {
    if (!isRecord(entry) || typeof entry.model !== "string" || !entry.model) return [];
    const launch = typeof entry.cmd === "string" ? parseLaunchCommand(entry.cmd) : {};
    return [
      {
        model: entry.model,
        state: normalizeState(entry.state),
        ...launch,
      },
    ];
  });
}

/** `GET /v1/models`. */
export function parseModelList(body: unknown): ReadonlyArray<LlamaSwapListedModel> {
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  return body.data.flatMap((entry): Array<LlamaSwapListedModel> => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) return [];
    const contextTokens = positiveInt(entry.context_length) ?? positiveInt(entry.context_window);
    return [{ id: entry.id, ...(contextTokens !== undefined ? { contextTokens } : {}) }];
  });
}

/**
 * Fills a running model's context from the listing when its launch command states none.
 * The listed figure is per slot, so it is recorded as one slot and never divided again.
 */
export function withListedContext(
  running: ReadonlyArray<LlamaSwapRunningModel>,
  listed: ReadonlyArray<LlamaSwapListedModel>,
): ReadonlyArray<LlamaSwapRunningModel> {
  return running.map((model) => {
    if (model.state !== "ready" || model.contextTokens !== undefined) return model;
    const contextTokens = listed.find((entry) => entry.id === model.model)?.contextTokens;
    return contextTokens === undefined ? model : { ...model, contextTokens, slots: 1 };
  });
}

/**
 * The backend (llama-server) text in one `data: {...}` line of `GET /api/events`, or undefined.
 * Each frame is `{"type":"logData","data":"<json>"}` whose data parses to
 * `{"data": "<text>", "source": "proxy" | "upstream"}`. Only `upstream` is the backend; `GET /logs`
 * carries llama-swap's own request log and never shows it.
 */
function parseBackendLogDataEvent(dataLine: string): string | undefined {
  try {
    const outer: unknown = JSON.parse(dataLine);
    if (!isRecord(outer) || outer.type !== "logData" || typeof outer.data !== "string") {
      return undefined;
    }
    const inner: unknown = JSON.parse(outer.data);
    if (!isRecord(inner) || inner.source !== "upstream" || typeof inner.data !== "string") {
      return undefined;
    }
    return inner.data;
  } catch {
    return undefined;
  }
}

/** Cap on the unparsed remainder, so a stream with no frame boundary cannot grow it forever. */
export const MAX_LOG_TAIL_BUFFER_CHARS = 64 * 1024;

/**
 * Feeds one decoded chunk of the `/api/events` stream. Frames end at a blank line, so a frame
 * split across reads waits in `buffer`. Returns the newest backend log line, if any.
 */
export function consumeLogChunk(
  buffer: string,
  chunk: string,
): { readonly buffer: string; readonly latestLine?: string } {
  const frames = (buffer + chunk).split("\n\n");
  let rest = frames.pop() ?? "";
  if (rest.length > MAX_LOG_TAIL_BUFFER_CHARS) rest = "";
  let latestLine: string | undefined;
  for (const frame of frames) {
    const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
    const text = dataLine && parseBackendLogDataEvent(dataLine.slice("data:".length));
    const lines = text ? text.split("\n").filter((line) => line.trim()) : [];
    if (lines.length > 0) latestLine = lines[lines.length - 1]!.trim();
  }
  return { buffer: rest, ...(latestLine !== undefined ? { latestLine } : {}) };
}

export type LlamaSwapAuthHeader = "authorization-bearer" | "api-key" | "x-api-key" | "basic";

/**
 * The one header that carries a key. Two headers on a request hung llama-swap, so this returns
 * exactly one. Basic sends the key as the password, or as `user:password` when it has a colon.
 */
export function authHeaderFor(
  style: LlamaSwapAuthHeader,
  apiKey: string,
): { readonly name: string; readonly value: string } {
  switch (style) {
    case "api-key":
      return { name: "api-key", value: apiKey };
    case "x-api-key":
      return { name: "x-api-key", value: apiKey };
    case "basic":
      return {
        name: "authorization",
        value: `Basic ${btoa(apiKey.includes(":") ? apiKey : `:${apiKey}`)}`,
      };
    default:
      return { name: "authorization", value: `Bearer ${apiKey}` };
  }
}
