import { expect, it } from "vite-plus/test";

import { llamaSwapLoadStage } from "./llamaSwapLoadStage";

const status = (running: Array<[string, "ready" | "starting" | "stopping"]>) => ({
  supported: true,
  authFailed: false,
  models: [],
  running: running.map(([model, state]) => ({ model, state })),
});

it("reports unloading first, then loading, and nothing once the model is ready", () => {
  expect(llamaSwapLoadStage(status([["old", "stopping"]]), "new")).toEqual({
    kind: "unloading",
    model: "old",
  });
  expect(llamaSwapLoadStage(status([["new", "starting"]]), "new")).toEqual({
    kind: "loading",
    model: "new",
  });
  expect(llamaSwapLoadStage(status([["new", "ready"]]), "new")).toBeNull();
  expect(llamaSwapLoadStage(status([]), "new")).toBeNull();
});
