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
 * project, so a switch or unload can name who loses it. `endpointOf` maps an instance id to its
 * endpoint origin; instances on another endpoint never conflict.
 */
export function modelSwapConflicts(input: {
  readonly threads: ReadonlyArray<SwapThread>;
  readonly projectTitles: ReadonlyMap<string, string>;
  readonly endpointOf: (instanceId: string) => string | undefined;
  readonly endpoint: string;
  readonly loadedModel: string;
  /** The thread making the pick, which is not in conflict with itself. */
  readonly excludeThreadId?: string;
}): ReadonlyArray<SwapConflictProject> {
  const byProject = new Map<string, SwapConflictProject["threads"][number][]>();
  for (const thread of input.threads) {
    if (
      thread.archivedAt ||
      thread.id === input.excludeThreadId ||
      thread.modelSelection.model !== input.loadedModel ||
      input.endpointOf(thread.modelSelection.instanceId) !== input.endpoint
    ) {
      continue;
    }
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
