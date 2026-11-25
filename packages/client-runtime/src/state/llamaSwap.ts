import type { LlamaSwapStatus } from "@t3tools/contracts";

/** Pure helpers for llama-swap model switches. No wire or atom code lives here. */

export interface SwapThread {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly archivedAt: unknown;
  readonly activeRunId: string | null;
  readonly modelSelection: { readonly instanceId: string; readonly model: string };
}

export interface SwapConflictProject {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly threads: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly running: boolean;
  }>;
}

/**
 * Non-archived threads that use the loaded model on the same llama-swap endpoint, grouped by
 * project, so a switch or unload can name who loses it. `locate` resolves a thread's model to its
 * endpoint origin and llama-swap model id; threads on another endpoint never conflict.
 */
export function modelSwapConflicts(input: {
  readonly threads: ReadonlyArray<SwapThread>;
  readonly projectTitles: ReadonlyMap<string, string>;
  /** Where a thread's model is served, and the id llama-swap knows it by. */
  readonly locate: (
    instanceId: string,
    model: string,
  ) => { readonly endpoint: string; readonly modelId: string } | undefined;
  readonly endpoint: string;
  readonly loadedModel: string;
  /** The thread making the pick, which is not in conflict with itself. */
  readonly excludeThreadId?: string;
}): ReadonlyArray<SwapConflictProject> {
  const byProject = new Map<string, SwapConflictProject["threads"][number][]>();
  for (const thread of input.threads) {
    if (thread.archivedAt || thread.id === input.excludeThreadId) continue;
    const place = input.locate(thread.modelSelection.instanceId, thread.modelSelection.model);
    if (place?.endpoint !== input.endpoint || place.modelId !== input.loadedModel) continue;
    const entry = { id: thread.id, title: thread.title, running: thread.activeRunId !== null };
    const list = byProject.get(thread.projectId);
    if (list) list.push(entry);
    else byProject.set(thread.projectId, [entry]);
  }
  return Array.from(byProject, ([projectId, threads]) => ({
    projectId,
    projectTitle: input.projectTitles.get(projectId) ?? projectId,
    threads,
  }));
}

/**
 * Tokens one request needs before the model has room to answer. Claude's figure is Codeman's
 * measurement (its system prompt and tools alone are about 36.4K). Codex, OpenCode and Pi are
 * unmeasured, so they have no floor and never warn.
 */
const CONTEXT_FLOOR_TOKENS: Readonly<Record<string, number>> = { claudeAgent: 40_000 };

export type ContextWarning =
  | { readonly kind: "unknown" }
  | { readonly kind: "tooSmall"; readonly perSlotTokens: number; readonly floorTokens: number };

/** Context per slot against the driver's floor. Undefined when nothing needs saying. */
export function contextWarning(input: {
  readonly driver: string;
  readonly contextTokens: number | undefined;
  readonly slots: number | undefined;
}): ContextWarning | undefined {
  const floorTokens = CONTEXT_FLOOR_TOKENS[input.driver];
  if (floorTokens === undefined) return undefined;
  if (input.contextTokens === undefined) return { kind: "unknown" };
  const perSlotTokens = Math.floor(input.contextTokens / (input.slots ?? 1));
  return perSlotTokens < floorTokens ? { kind: "tooSmall", perSlotTokens, floorTokens } : undefined;
}

/**
 * Where a model is served. OpenCode and Pi prefix a slug with the upstream provider, which can
 * have its own endpoint; every other model uses the instance's endpoint and its slug as the id.
 */
export function locateLlamaSwapModel(
  snapshot: {
    readonly auth: { readonly endpoint?: string | undefined };
    readonly subProviderEndpoints?: Readonly<Record<string, string>> | undefined;
  },
  model: string,
):
  | { readonly endpoint: string; readonly modelId: string; readonly subProvider?: string }
  | undefined {
  const slash = model.indexOf("/");
  const subProvider = slash > 0 ? model.slice(0, slash) : undefined;
  const upstream =
    subProvider === undefined ? undefined : snapshot.subProviderEndpoints?.[subProvider];
  if (subProvider !== undefined && upstream !== undefined) {
    return { endpoint: upstream, modelId: model.slice(slash + 1), subProvider };
  }
  const endpoint = snapshot.auth.endpoint;
  return endpoint === undefined ? undefined : { endpoint, modelId: model };
}

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

export type LlamaSwapLoadStage =
  | { readonly kind: "unloading"; readonly model: string }
  | { readonly kind: "loading"; readonly model: string };

/**
 * What llama-swap is doing for a thread's model, or null when it is ready or idle.
 * llama-swap unloads the old model before it starts the new one, so an unload in progress
 * is the first stage and the thread's model starting is the second.
 */
export function llamaSwapLoadStage(
  status: LlamaSwapStatus,
  model: string,
): LlamaSwapLoadStage | null {
  if (status.running.some((entry) => entry.model === model && entry.state === "ready")) return null;
  const stopping = status.running.find((entry) => entry.state === "stopping");
  if (stopping) return { kind: "unloading", model: stopping.model };
  return status.running.some((entry) => entry.model === model && entry.state === "starting")
    ? { kind: "loading", model }
    : null;
}
