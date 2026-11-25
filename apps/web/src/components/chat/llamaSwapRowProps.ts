import type { LlamaSwapStatus } from "@t3tools/contracts";

import type { LlamaSwapView } from "./useLlamaSwapStatus";

/** What one picker row shows about its model on a llama-swap server. */
export function llamaSwapRowProps(
  slug: string,
  running: ReadonlyMap<string, LlamaSwapStatus["running"][number]>,
  listed: ReadonlyMap<string, LlamaSwapStatus["models"][number]>,
  view: Pick<LlamaSwapView, "canUnload" | "unload">,
) {
  const loaded = running.get(slug);
  const state = loaded && loaded.state !== "unknown" ? loaded.state : undefined;
  // A loaded model's figure is the whole window, so show what one request can use.
  const contextTokens =
    loaded?.contextTokens !== undefined && loaded.slots
      ? Math.floor(loaded.contextTokens / loaded.slots)
      : (loaded?.contextTokens ?? listed.get(slug)?.contextTokens);
  return {
    loadState: state,
    contextTokens,
    onUnload: view.canUnload && state === "ready" ? () => view.unload(slug) : undefined,
  };
}
