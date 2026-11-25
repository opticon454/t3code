import { expect, it, vi } from "vite-plus/test";

import { llamaSwapRowProps } from "./llamaSwapRowProps";

const running = new Map([
  ["qwen", { model: "qwen", state: "ready" as const, contextTokens: 65536, slots: 2 }],
  ["gemma", { model: "gemma", state: "starting" as const }],
  ["odd", { model: "odd", state: "unknown" as const }],
]);
const listed = new Map([["idle", { id: "idle", contextTokens: 8192 }]]);

it("shows loaded state, per-slot context and an unload action for a ready model", () => {
  const unload = vi.fn();
  const row = llamaSwapRowProps("qwen", running, listed, { canUnload: true, unload });
  expect(row).toMatchObject({ loadState: "ready", contextTokens: 32768 });
  row.onUnload?.();
  expect(unload).toHaveBeenCalledWith("qwen");
});

it("hides unload without permission or while loading, and ignores unknown states", () => {
  const view = { canUnload: false, unload: vi.fn() };
  expect(llamaSwapRowProps("qwen", running, listed, view).onUnload).toBeUndefined();
  const loading = llamaSwapRowProps("gemma", running, listed, { ...view, canUnload: true });
  expect(loading).toMatchObject({ loadState: "starting", onUnload: undefined });
  expect(llamaSwapRowProps("odd", running, listed, view).loadState).toBeUndefined();
});

it("falls back to the listed context for an unloaded model", () => {
  expect(llamaSwapRowProps("idle", running, listed, { canUnload: true, unload: vi.fn() })).toEqual({
    loadState: undefined,
    contextTokens: 8192,
    onUnload: undefined,
  });
});
