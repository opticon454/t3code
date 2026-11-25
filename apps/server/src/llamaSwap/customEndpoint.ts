import {
  CustomEndpointError,
  type CustomEndpointModel,
  CustomModelEndpointConfig,
  type CustomModelEndpointId,
  type ProviderInstanceId,
  settingsSecretLiteral,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { SECRET_REDACTED } from "../settingsSecrets.ts";
import { resolveSettingsSecrets } from "../secrets/settingsSecretValue.ts";
import type * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import type * as ServerSettings from "../serverSettings.ts";
import type { LlamaSwapEndpoint } from "./LlamaSwapService.ts";
import { HttpClient, HttpClientRequest } from "effect/http";
import { authHeaderFor, normalizeLlamaSwapOrigin, parseModelList } from "./llamaSwapProtocol.ts";

/**
 * The saved endpoint an instance uses, with its key read, shaped for llama-swap calls. Undefined
 * when the instance has no endpoint, or its URL is not usable. A key that cannot be read leaves
 * the endpoint without one, so the server answers 401 rather than a wrong credential going out.
 */
export const makeCustomEndpointLookup =
  (
    settings: ServerSettings.ServerSettingsService["Service"],
    secrets: SecretResolver.SecretResolver["Service"],
  ) =>
  (instanceId: ProviderInstanceId) =>
    Effect.gen(function* () {
      const current = yield* settings.getSettings;
      const endpointId = current.providerInstances[instanceId]?.endpointId;
      const endpoint =
        endpointId === undefined ? undefined : current.customModelEndpoints[endpointId];
      const origin = endpoint && normalizeLlamaSwapOrigin(endpoint.baseUrl);
      if (!endpoint || !origin) return undefined;
      const resolved = yield* resolveSettingsSecrets(secrets, CustomModelEndpointConfig, endpoint);
      const apiKey = settingsSecretLiteral(resolved.apiKey);
      return {
        origin,
        ...(apiKey ? { apiKey } : {}),
        authHeader: endpoint.authHeader,
        ...(endpoint.contextTokens === undefined
          ? {}
          : { defaultContextTokens: endpoint.contextTokens }),
      } satisfies LlamaSwapEndpoint;
    }).pipe(Effect.orElseSucceed(() => undefined));

/** `{base}/v1/models`, or `{base}/models` when the base already ends in a version segment. */
export function endpointModelsUrl(baseUrl: string, apiVersion?: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
  return apiVersion ? `${url}?api-version=${encodeURIComponent(apiVersion)}` : url;
}

/**
 * Lists the models a saved or unsaved endpoint serves. A redacted key in the form keeps the one
 * saved under the same id.
 */
export const makeCustomEndpointModels = (
  settings: ServerSettings.ServerSettingsService["Service"],
  secrets: SecretResolver.SecretResolver["Service"],
  client: HttpClient.HttpClient,
) => ({
  list: Effect.fn("CustomEndpoint.listModels")(function* (input: {
    readonly id: CustomModelEndpointId;
    readonly config?: CustomModelEndpointConfig | undefined;
  }) {
    const fail = (detail: string) => new CustomEndpointError({ detail });
    const saved = (yield* settings.getSettings.pipe(
      Effect.mapError(() => fail("Settings could not be read.")),
    )).customModelEndpoints[input.id];
    const config = input.config ?? saved;
    if (!config) return yield* fail("Unknown endpoint.");
    const key = config.apiKey === SECRET_REDACTED && saved ? saved.apiKey : config.apiKey;
    const resolved = yield* resolveSettingsSecrets(secrets, CustomModelEndpointConfig, {
      ...config,
      apiKey: key,
    }).pipe(Effect.mapError(() => fail("The API key could not be read.")));
    const apiKey = settingsSecretLiteral(resolved.apiKey);
    let request = HttpClientRequest.get(endpointModelsUrl(config.baseUrl, config.apiVersion));
    if (apiKey) {
      const header = authHeaderFor(config.authHeader, apiKey);
      request = HttpClientRequest.setHeader(request, header.name, header.value);
    }
    const response = yield* client.execute(request).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError(() => fail("The endpoint did not answer.")),
    );
    if (response.status === 401 || response.status === 403) {
      return yield* fail("The endpoint rejected the API key.");
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* fail(`The endpoint answered ${response.status}.`);
    }
    const body = yield* response.json.pipe(
      Effect.mapError(() => fail("The endpoint did not return a model list.")),
    );
    return parseModelList(body).map((model): CustomEndpointModel => ({
      id: model.id,
      ...((model.contextTokens ?? config.contextTokens) === undefined
        ? {}
        : { contextTokens: model.contextTokens ?? config.contextTokens! }),
    }));
  }),
});
