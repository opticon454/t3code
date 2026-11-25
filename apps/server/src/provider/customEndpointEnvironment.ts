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
  if (driver === "codex") return codexEnvironment(endpoint);
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

const CODEX_KEY_VARIABLE = "T3_ENDPOINT_API_KEY";
const CODEX_PROVIDER_ID = "t3_endpoint";

const toml = (value: string) => JSON.stringify(value);

/**
 * Codex reads a custom provider from `-c` overrides, which T3 takes from this variable. The key
 * travels in its own environment variable, and Codex names it as `env_key` (bearer) or in
 * `env_http_headers` (any other header), so it is never written into an argument.
 * Codex appends `/responses`, so a bare host gets `/v1`.
 */
function codexEnvironment(endpoint: CustomModelEndpointConfig): ProviderInstanceEnvironment {
  const url = URL.parse(endpoint.baseUrl);
  if (!url) return [];
  const baseUrl = url.pathname === "/" ? `${url.origin}/v1` : `${url.origin}${url.pathname}`;
  const prefix = `model_providers.${CODEX_PROVIDER_ID}`;
  const overrides = [
    `model_provider=${toml(CODEX_PROVIDER_ID)}`,
    `${prefix}.name=${toml(endpoint.label ?? "Custom endpoint")}`,
    `${prefix}.base_url=${toml(baseUrl)}`,
    `${prefix}.wire_api="responses"`,
  ];
  if (endpoint.apiVersion) {
    overrides.push(`${prefix}.query_params={ api-version = ${toml(endpoint.apiVersion)} }`);
  }
  const env: ProviderInstanceEnvironment[number][] = [];
  if (hasKey(endpoint.apiKey)) {
    env.push(variable(CODEX_KEY_VARIABLE, endpoint.apiKey, true));
    if (endpoint.authHeader === "authorization-bearer") {
      overrides.push(`${prefix}.env_key=${toml(CODEX_KEY_VARIABLE)}`);
    } else if (endpoint.authHeader === "basic") {
      // A computed header cannot come from the environment, so Basic needs a literal key.
      if (typeof endpoint.apiKey === "string") {
        const basic = `Basic ${btoa(endpoint.apiKey.includes(":") ? endpoint.apiKey : `:${endpoint.apiKey}`)}`;
        overrides.push(`${prefix}.http_headers={ authorization = ${toml(basic)} }`);
      }
    } else {
      overrides.push(
        `${prefix}.env_http_headers={ ${endpoint.authHeader} = ${toml(CODEX_KEY_VARIABLE)} }`,
      );
    }
  }
  const args = overrides.map((override) => `-c '${override}'`).join(" ");
  return [...env, variable("T3CODE_CODEX_LAUNCH_ARGS", args)];
}
