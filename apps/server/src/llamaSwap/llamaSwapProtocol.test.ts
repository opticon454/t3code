import { describe, expect, it } from "vite-plus/test";

import {
  authHeaderFor,
  consumeLogChunk,
  MAX_LOG_TAIL_BUFFER_CHARS,
  normalizeLlamaSwapOrigin,
  parseLaunchCommand,
  parseModelList,
  parseRunning,
  resolveLlamaSwapApiKey,
  withListedContext,
} from "./llamaSwapProtocol.ts";

const logFrame = (source: string, data: string) =>
  `data: ${JSON.stringify({ type: "logData", data: JSON.stringify({ source, data }) })}\n\n`;

describe("normalizeLlamaSwapOrigin", () => {
  it("keeps only the origin of an http(s) URL without credentials", () => {
    expect(normalizeLlamaSwapOrigin(" http://10.0.0.5:8080/v1 ")).toBe("http://10.0.0.5:8080");
    expect(normalizeLlamaSwapOrigin("ftp://host")).toBeUndefined();
    expect(normalizeLlamaSwapOrigin("http://user:pw@host")).toBeUndefined();
    expect(normalizeLlamaSwapOrigin("not a url")).toBeUndefined();
  });
});

describe("resolveLlamaSwapApiKey", () => {
  it("prefers LLAMA_SWAP_API_KEY, then the provider's own credential", () => {
    expect(
      resolveLlamaSwapApiKey({
        LLAMA_SWAP_API_KEY: " swap ",
        ANTHROPIC_AUTH_TOKEN: "claude",
      }),
    ).toBe("swap");
    expect(
      resolveLlamaSwapApiKey({ MY_KEY: "codex", ANTHROPIC_API_KEY: "claude" }, ["MY_KEY"]),
    ).toBe("codex");
    expect(resolveLlamaSwapApiKey({ ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_API_KEY: "k" })).toBe("t");
  });

  it("ignores empty and non-string values", () => {
    expect(resolveLlamaSwapApiKey({ ANTHROPIC_AUTH_TOKEN: "  ", ANTHROPIC_API_KEY: 3 })).toBe(
      undefined,
    );
  });
});

describe("parseLaunchCommand", () => {
  it("reads --fit-ctx before -c and --ctx-size", () => {
    expect(parseLaunchCommand("llama-server --ctx-size 8192 --fit-ctx 16384 -np 2")).toEqual({
      contextTokens: 16384,
      slots: 2,
    });
  });

  it("reads -c, --ctx-size, --flag=value and --parallel", () => {
    expect(parseLaunchCommand("llama-server -c 32768")).toEqual({ contextTokens: 32768 });
    expect(parseLaunchCommand("llama-server\n  --ctx-size=4096\n  --parallel=3")).toEqual({
      contextTokens: 4096,
      slots: 3,
    });
  });

  it("does not mistake -cb or a missing value for a context flag", () => {
    expect(parseLaunchCommand("llama-server -cb 512 -c")).toEqual({});
    expect(parseLaunchCommand("llama-server --fit-ctx abc")).toEqual({});
  });
});

describe("parseRunning", () => {
  it("is undefined for anything that is not llama-swap's shape", () => {
    expect(parseRunning({})).toBeUndefined();
    expect(parseRunning(null)).toBeUndefined();
    expect(parseRunning({ running: "x" })).toBeUndefined();
  });

  it("maps models, states and launch commands, dropping malformed entries", () => {
    expect(
      parseRunning({
        running: [
          { model: "qwen", state: "ready", cmd: "llama-server --fit-ctx 16384 -np 1" },
          { model: "gemma", state: "starting" },
          { model: "odd", state: "shutdown" },
          { state: "ready" },
          null,
        ],
      }),
    ).toEqual([
      { model: "qwen", state: "ready", contextTokens: 16384, slots: 1 },
      { model: "gemma", state: "starting" },
      { model: "odd", state: "unknown" },
    ]);
  });
});

describe("parseModelList and withListedContext", () => {
  const listed = parseModelList({
    data: [
      { id: "qwen", context_length: 16384 },
      { id: "gemma", context_window: 8192 },
      { id: "" },
    ],
  });

  it("reads context_length, then context_window", () => {
    expect(listed).toEqual([
      { id: "qwen", contextTokens: 16384 },
      { id: "gemma", contextTokens: 8192 },
    ]);
    expect(parseModelList({})).toEqual([]);
  });

  it("fills a ready model from the listing as one slot, and leaves the rest alone", () => {
    expect(
      withListedContext(
        [
          { model: "qwen", state: "ready" },
          { model: "gemma", state: "starting" },
          { model: "kept", state: "ready", contextTokens: 4096, slots: 2 },
        ],
        listed,
      ),
    ).toEqual([
      { model: "qwen", state: "ready", contextTokens: 16384, slots: 1 },
      { model: "gemma", state: "starting" },
      { model: "kept", state: "ready", contextTokens: 4096, slots: 2 },
    ]);
  });
});

describe("consumeLogChunk", () => {
  it("returns the newest backend line and ignores llama-swap's own proxy lines", () => {
    const chunk =
      logFrame("upstream", "load_model: loading model 'a.gguf'\n") +
      logFrame("proxy", "GET /v1/models 200\n") +
      logFrame("upstream", "tokenizer warning\nllama_server: model loaded\n");
    expect(consumeLogChunk("", chunk)).toEqual({
      buffer: "",
      latestLine: "llama_server: model loaded",
    });
  });

  it("waits for a frame split across reads", () => {
    const frame = logFrame("upstream", "half\n");
    const first = consumeLogChunk("", frame.slice(0, 20));
    expect(first).toEqual({ buffer: frame.slice(0, 20) });
    expect(consumeLogChunk(first.buffer, frame.slice(20))).toEqual({
      buffer: "",
      latestLine: "half",
    });
  });

  it("skips malformed frames and drops an unbounded remainder", () => {
    expect(consumeLogChunk("", "data: not json\n\nevent: ping\n\n")).toEqual({ buffer: "" });
    expect(consumeLogChunk("", "x".repeat(MAX_LOG_TAIL_BUFFER_CHARS + 1))).toEqual({ buffer: "" });
  });
});

describe("authHeaderFor", () => {
  it("returns exactly one header in the requested style", () => {
    expect(authHeaderFor("authorization-bearer", "k")).toEqual({
      name: "authorization",
      value: "Bearer k",
    });
    expect(authHeaderFor("api-key", "k")).toEqual({ name: "api-key", value: "k" });
    expect(authHeaderFor("x-api-key", "k")).toEqual({ name: "x-api-key", value: "k" });
    expect(authHeaderFor("basic", "k").value).toBe(`Basic ${btoa(":k")}`);
    expect(authHeaderFor("basic", "u:p").value).toBe(`Basic ${btoa("u:p")}`);
  });
});
