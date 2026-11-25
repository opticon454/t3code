import {
  CustomModelEndpointConfig,
  type ProviderInstanceId,
  settingsSecretLiteral,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { resolveSettingsSecrets } from "../secrets/settingsSecretValue.ts";
import type * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import type * as ServerSettings from "../serverSettings.ts";
import type { LlamaSwapEndpoint } from "./LlamaSwapService.ts";
import { normalizeLlamaSwapOrigin } from "./llamaSwapProtocol.ts";

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
