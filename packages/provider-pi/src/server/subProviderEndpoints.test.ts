import { expect, it } from "vite-plus/test";

import { piSubProviderEndpoints } from "./subProviderEndpoints.ts";

it("reads each provider's base URL as an origin and ignores the rest", () => {
  expect(
    piSubProviderEndpoints({
      providers: {
        swap: { baseUrl: "http://10.0.0.5:8080/v1", api: "openai-completions" },
        none: {},
        bad: { baseUrl: "ftp://x" },
      },
    }),
  ).toEqual({ swap: "http://10.0.0.5:8080" });
  expect(piSubProviderEndpoints(null)).toBeUndefined();
  expect(piSubProviderEndpoints({ providers: {} })).toBeUndefined();
});
