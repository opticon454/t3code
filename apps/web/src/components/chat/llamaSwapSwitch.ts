import type { LlamaSwapStatus } from "@t3tools/contracts";
import {
  contextWarning,
  modelSwapConflicts,
  type ContextWarning,
  type SwapConflictProject,
  type SwapThread,
} from "@t3tools/client-runtime/state/llamaSwap";

export interface LlamaSwapSwitchPlan {
  readonly loadedModel: string | undefined;
  readonly conflicts: ReadonlyArray<SwapConflictProject>;
  readonly warning: ContextWarning | undefined;
}

/**
 * What a pick or unload would cost, or null when it costs nothing worth confirming. Picking the
 * loaded model never does; picking another one unloads the loaded model, so its other users are
 * named; and a model whose per-request context is below the provider's floor is warned about.
 */
export function planLlamaSwapSwitch(input: {
  readonly status: LlamaSwapStatus;
  readonly driver: string;
  /** The model being picked, or null when the loaded model is being unloaded. */
  readonly picked: string | null;
  readonly endpoint: string;
  readonly threads: ReadonlyArray<SwapThread>;
  readonly projectTitles: ReadonlyMap<string, string>;
  readonly locate: Parameters<typeof modelSwapConflicts>[0]["locate"];
  readonly unloadModel?: string;
}): LlamaSwapSwitchPlan | null {
  const loaded = input.status.running.find((entry) => entry.state === "ready");
  const loadedModel = input.unloadModel ?? loaded?.model;
  if (input.picked !== null && input.picked === loadedModel) return null;
  const conflicts =
    loadedModel === undefined
      ? []
      : modelSwapConflicts({
          threads: input.threads,
          projectTitles: input.projectTitles,
          locate: input.locate,
          endpoint: input.endpoint,
          loadedModel,
        });
  const listed =
    input.picked === null ? undefined : input.status.models.find((m) => m.id === input.picked);
  const warning =
    input.picked === null
      ? undefined
      : contextWarning({ driver: input.driver, contextTokens: listed?.contextTokens, slots: 1 });
  return conflicts.length === 0 && warning === undefined
    ? null
    : { loadedModel, conflicts, warning };
}
