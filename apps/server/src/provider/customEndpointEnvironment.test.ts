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
  expect(customEndpointEnvironment("codex", endpoint("x-api-key"))).toEqual([]);
});
