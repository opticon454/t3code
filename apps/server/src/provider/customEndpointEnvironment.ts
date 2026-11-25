import type {
  CustomModelEndpointConfig,
  ProviderInstanceEnvironment,
  SettingsSecretValue,
} from "@t3tools/contracts";

const variable = (
  name: string,
  value: string | Exclude<SettingsSecretValue, string>,
  sensitive = false,
) => ({ name, value, sensitive }) as ProviderInstanceEnvironment[number];

const hasKey = (apiKey: SettingsSecretValue): boolean =>
  typeof apiKey !== "string" || apiKey.length > 0;

/**
 * The environment a driver needs to talk to a saved endpoint. The instance's own variables are
 * applied after these, so they win. A driver with no entry here is configured in its own files.
 *
 * Claude Code takes a bearer token or an `x-api-key` natively; any other header goes through
 * `ANTHROPIC_CUSTOM_HEADERS`, with both native credentials emptied so one header is sent.
 */
export function customEndpointEnvironment(
  driver: string,
  endpoint: CustomModelEndpointConfig,
): ProviderInstanceEnvironment {
  if (driver !== "claudeAgent") return [];
  const env: ProviderInstanceEnvironment[number][] = [
    variable("ANTHROPIC_BASE_URL", endpoint.baseUrl),
    variable("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", "1"),
  ];
  const key = endpoint.apiKey;
  if (!hasKey(key)) return env;
  switch (endpoint.authHeader) {
    case "x-api-key":
      env.push(variable("ANTHROPIC_API_KEY", key, true), variable("ANTHROPIC_AUTH_TOKEN", ""));
      break;
    case "authorization-bearer":
      env.push(variable("ANTHROPIC_AUTH_TOKEN", key, true), variable("ANTHROPIC_API_KEY", ""));
      break;
    default:
      // A secret reference cannot be placed inside a header string, so only a literal key works.
      if (typeof key === "string") {
        const header =
          endpoint.authHeader === "basic"
            ? `authorization: Basic ${btoa(key.includes(":") ? key : `:${key}`)}`
            : `api-key: ${key}`;
        env.push(
          variable("ANTHROPIC_CUSTOM_HEADERS", header, true),
          variable("ANTHROPIC_AUTH_TOKEN", ""),
          variable("ANTHROPIC_API_KEY", ""),
        );
      }
  }
  return env;
}
