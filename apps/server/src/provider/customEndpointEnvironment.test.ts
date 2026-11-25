import { expect, it } from "vite-plus/test";

import { customEndpointEnvironment } from "./customEndpointEnvironment.ts";

const endpoint = (authHeader: string, apiKey = "k") =>
  ({ baseUrl: "http://swap:8080", apiKey, authHeader }) as never;
const env = (driver: string, authHeader: string, apiKey?: string) =>
  Object.fromEntries(
    customEndpointEnvironment(driver, endpoint(authHeader, apiKey)).map((v) => [v.name, v.value]),
  );

it("gives Claude one credential header in the endpoint's style", () => {
  expect(env("claudeAgent", "authorization-bearer")).toMatchObject({
    ANTHROPIC_BASE_URL: "http://swap:8080",
    ANTHROPIC_AUTH_TOKEN: "k",
    ANTHROPIC_API_KEY: "",
  });
  expect(env("claudeAgent", "x-api-key")).toMatchObject({
    ANTHROPIC_API_KEY: "k",
    ANTHROPIC_AUTH_TOKEN: "",
  });
  expect(env("claudeAgent", "api-key")).toMatchObject({
    ANTHROPIC_CUSTOM_HEADERS: "api-key: k",
    ANTHROPIC_AUTH_TOKEN: "",
    ANTHROPIC_API_KEY: "",
  });
});

it("sets only the address when there is no key, and nothing for other drivers", () => {
  expect(Object.keys(env("claudeAgent", "authorization-bearer", ""))).toEqual([
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
  ]);
  expect(customEndpointEnvironment("opencode", endpoint("x-api-key"))).toEqual([]);
});

it("gives Codex a custom provider through launch arguments and a key variable", () => {
  const bearer = Object.fromEntries(
    customEndpointEnvironment("codex", endpoint("authorization-bearer")).map((v) => [
      v.name,
      v.value,
    ]),
  );
  expect(bearer.T3_ENDPOINT_API_KEY).toBe("k");
  expect(bearer.T3CODE_CODEX_LAUNCH_ARGS).toContain(
    `-c 'model_providers.t3_endpoint.base_url="http://swap:8080/v1"'`,
  );
  expect(bearer.T3CODE_CODEX_LAUNCH_ARGS).toContain(
    `-c 'model_providers.t3_endpoint.env_key="T3_ENDPOINT_API_KEY"'`,
  );
  const azure = Object.fromEntries(
    customEndpointEnvironment("codex", {
      ...(endpoint("api-key") as object),
      apiVersion: "2024-10-21",
    } as never).map((v) => [v.name, v.value]),
  );
  expect(azure.T3CODE_CODEX_LAUNCH_ARGS).toContain(
    `env_http_headers={ api-key = "T3_ENDPOINT_API_KEY" }`,
  );
  expect(azure.T3CODE_CODEX_LAUNCH_ARGS).toContain(`query_params={ api-version = "2024-10-21" }`);
  expect(azure.T3CODE_CODEX_LAUNCH_ARGS).not.toContain("env_key");
});
