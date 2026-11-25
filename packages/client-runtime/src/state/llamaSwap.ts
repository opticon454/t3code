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
