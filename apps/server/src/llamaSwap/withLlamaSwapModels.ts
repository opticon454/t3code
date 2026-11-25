import type { ServerProviderDraft } from "@t3tools/provider-core/server/snapshotProbe";
import * as Effect from "effect/Effect";
import type { HttpClient } from "effect/http";

import { fetchLlamaSwapStatus } from "./LlamaSwapService.ts";
import { resolveLlamaSwapApiKey } from "./llamaSwapProtocol.ts";

/**
 * Adds the models a llama-swap endpoint lists to a provider whose own catalog omits them, as
 * custom models that borrow the first listed model's capabilities. A slug already listed stays
 * as it is. Any failure, or a server that is not llama-swap, leaves the draft unchanged.
 */
export const withLlamaSwapModels = Effect.fn("withLlamaSwapModels")(function* (
  draft: ServerProviderDraft,
  client: HttpClient.HttpClient,
  environment: Readonly<Record<string, unknown>>,
) {
  const origin = draft.auth.endpoint;
  if (!origin) return draft;
  const apiKey = resolveLlamaSwapApiKey(environment);
  const status = yield* fetchLlamaSwapStatus(client, { origin, ...(apiKey ? { apiKey } : {}) });
  if (!status.supported) return draft;
  const known = new Set(draft.models.map((model) => model.slug));
  const capabilities = draft.models.find((model) => model.capabilities)?.capabilities ?? null;
  const added = status.models
    .filter((model) => !known.has(model.id))
    .map((model) => ({ slug: model.id, name: model.id, isCustom: true, capabilities }));
  return added.length === 0 ? draft : { ...draft, models: [...draft.models, ...added] };
});
