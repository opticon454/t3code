import { expect, it } from "vite-plus/test";

import { openCodeSubProviderEndpoints } from "./subProviderEndpoints.ts";

it("lists only connected providers with an http(s) base URL, as origins", () => {
  expect(
    openCodeSubProviderEndpoints(
      [
        { id: "swap", options: { baseURL: "http://10.0.0.5:8080/v1" } },
        { id: "off", options: { baseURL: "http://other:1/v1" } },
        { id: "plain", options: {} },
        { id: "odd", options: { baseURL: "file:///x" } },
      ],
      ["swap", "plain", "odd"],
    ),
  ).toEqual({ swap: "http://10.0.0.5:8080" });
  expect(openCodeSubProviderEndpoints([], [])).toBeUndefined();
});
