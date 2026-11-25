import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/** A llama-swap server is addressed by the provider instance that uses it, never by URL. */
export const LlamaSwapSubscribeInput = Schema.Struct({
  instanceId: ProviderInstanceId,
});
export type LlamaSwapSubscribeInput = typeof LlamaSwapSubscribeInput.Type;

export const LlamaSwapUnloadInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
});
export type LlamaSwapUnloadInput = typeof LlamaSwapUnloadInput.Type;

const TokenCount = Schema.Int.check(Schema.isGreaterThan(0));

export const LlamaSwapStatus = Schema.Struct({
  /** True only when the instance's endpoint answered as llama-swap. */
  supported: Schema.Boolean,
  /** llama-swap rejected the API key. */
  authFailed: Schema.Boolean,
  running: Schema.Array(
    Schema.Struct({
      model: TrimmedNonEmptyString,
      state: Schema.Literals(["ready", "starting", "stopping", "unknown"]),
      contextTokens: Schema.optionalKey(TokenCount),
      slots: Schema.optionalKey(TokenCount),
    }),
  ),
  models: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      contextTokens: Schema.optionalKey(TokenCount),
    }),
  ),
  /** Newest llama.cpp output line while a model is loading or unloading. */
  logLine: Schema.optionalKey(Schema.String),
});
export type LlamaSwapStatus = typeof LlamaSwapStatus.Type;

export class LlamaSwapError extends Schema.TaggedError<LlamaSwapError>()("LlamaSwapError", {
  instanceId: ProviderInstanceId,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
