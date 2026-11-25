import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { CustomModelEndpointId } from "./customModelEndpointId.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { CustomModelEndpointConfig } from "./settings.ts";

/** A llama-swap server is addressed by the provider instance that uses it, never by URL. */
export const LlamaSwapSubscribeInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  /** The upstream provider id for OpenCode and Pi, which can point each one at its own server. */
  subProvider: Schema.optional(TrimmedNonEmptyString),
});
export type LlamaSwapSubscribeInput = typeof LlamaSwapSubscribeInput.Type;

export const LlamaSwapUnloadInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  subProvider: Schema.optional(TrimmedNonEmptyString),
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

/** A thread's model was replaced on its llama-swap server by another client's request. */
export const LlamaSwapSwapEvent = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  previousModel: TrimmedNonEmptyString,
  loadedModel: TrimmedNonEmptyString,
});
export type LlamaSwapSwapEvent = typeof LlamaSwapSwapEvent.Type;

/** Lists an endpoint's models, for the Discover button and the default-model choice. */
export const ListCustomEndpointModelsInput = Schema.Struct({
  id: CustomModelEndpointId,
  /** Unsaved form values to try. A redacted key keeps the one saved under `id`. */
  config: Schema.optional(CustomModelEndpointConfig),
});
export type ListCustomEndpointModelsInput = typeof ListCustomEndpointModelsInput.Type;

export const CustomEndpointModel = Schema.Struct({
  id: TrimmedNonEmptyString,
  contextTokens: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type CustomEndpointModel = typeof CustomEndpointModel.Type;

export class CustomEndpointError extends Schema.TaggedError<CustomEndpointError>()(
  "CustomEndpointError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
