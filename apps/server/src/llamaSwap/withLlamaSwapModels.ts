import type { ServerProviderDraft } from "@t3tools/provider-core/server/snapshotProbe";
import * as Effect from "effect/Effect";
import type { HttpClient } from "effect/http";

import { fetchLlamaSwapStatus } from "./LlamaSwapService.ts";
import { resolveLlamaSwapCredential } from "./llamaSwapProtocol.ts";

/**
 * Adds the models a llama-swap endpoint lists that the provider does not. They are not marked
 * custom: clients drop custom models that settings do not hold, and only others can be hidden.
 * A failure, or a server that is not llama-swap, leaves the draft unchanged.
 */
export const withLlamaSwapModels = Effect.fn("withLlamaSwapModels")(function* (
  draft: ServerProviderDraft,
  client: HttpClient.HttpClient,
  environment: Readonly<Record<string, unknown>>,
  /** The saved endpoint's origin, for a provider whose own snapshot does not report one. */
  endpointOrigin?: string,
) {
  const origin = draft.auth.endpoint ?? endpointOrigin;
  if (!origin) return draft;
  const status = yield* fetchLlamaSwapStatus(client, {
    origin,
    ...resolveLlamaSwapCredential(environment),
  });
  if (!status.supported) return draft;
  const known = new Set(draft.models.map((model) => model.slug));
  const capabilities = draft.models.find((model) => model.capabilities)?.capabilities ?? null;
  const added = status.models
    .filter((model) => !known.has(model.id))
    .map((model) => ({ slug: model.id, name: model.id, isCustom: false, capabilities }));
  return added.length === 0 ? draft : { ...draft, models: [...draft.models, ...added] };
});
