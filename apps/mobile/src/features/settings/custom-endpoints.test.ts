import { expect, it } from "vite-plus/test";

import { EMPTY_ENDPOINT_DRAFT, planCustomEndpointSave } from "./custom-endpoints";

const draft = { ...EMPTY_ENDPOINT_DRAFT, id: "swap", baseUrl: "http://10.0.0.5:8080" };

it("builds a config from a valid draft, with Azure's api-key header", () => {
  const plan = planCustomEndpointSave({
    draft: { ...draft, apiKey: "k", authHeader: "api-key", contextTokens: "131072" },
    existing: undefined,
    takenIds: [],
  });
  expect(plan?.id).toBe("swap");
  expect(plan?.config).toMatchObject({
    baseUrl: "http://10.0.0.5:8080",
    apiKey: "k",
    authHeader: "api-key",
    contextTokens: 131072,
  });
});

it("rejects a bad id, a taken id and a bad URL", () => {
  const plan = (over: Partial<typeof draft>, takenIds: Array<string> = []) =>
    planCustomEndpointSave({ draft: { ...draft, ...over }, existing: undefined, takenIds });
  expect(plan({ id: "Bad Id" })).toBeNull();
  expect(plan({}, ["swap"])).toBeNull();
  expect(plan({ baseUrl: "ftp://x" })).toBeNull();
});

it("keeps the saved key when the field is left blank on edit", () => {
  const existing = planCustomEndpointSave({
    draft: { ...draft, apiKey: "k" },
    existing: undefined,
    takenIds: [],
  })!.config;
  const redacted = { ...existing, apiKey: "••••••" };
  expect(
    planCustomEndpointSave({ draft, existing: redacted, takenIds: ["swap"] })?.config.apiKey,
  ).toBe(redacted.apiKey);
});
