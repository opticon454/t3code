import { expect, it } from "vite-plus/test";

import { endpointModelsUrl } from "./customEndpoint.ts";

it("builds the model list URL, with Azure's api-version when set", () => {
  expect(endpointModelsUrl("http://swap:8080")).toBe("http://swap:8080/v1/models");
  expect(endpointModelsUrl("http://swap:8080/")).toBe("http://swap:8080/v1/models");
  expect(endpointModelsUrl("https://x.test/openai/v1")).toBe("https://x.test/openai/v1/models");
  expect(endpointModelsUrl("https://x.openai.azure.com/openai", "2024-10-21")).toBe(
    "https://x.openai.azure.com/openai/v1/models?api-version=2024-10-21",
  );
});
