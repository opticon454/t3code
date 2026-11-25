import { describe, expect, it } from "vite-plus/test";

import {
  contextWarning,
  locateLlamaSwapModel,
  modelSwapConflicts,
  llamaSwapLoadStage,
  planLlamaSwapSwitch,
  type SwapThread,
} from "./llamaSwap.ts";

const thread = (
  id: string,
  over: Partial<SwapThread> & { model?: string; instance?: string } = {},
) =>
  ({
    id,
    projectId: "p1",
    title: id,
    archivedAt: null,
    activeRunId: null,
    ...over,
    modelSelection: { instanceId: over.instance ?? "a", model: over.model ?? "qwen" },
  }) satisfies SwapThread;

const locate = (instanceId: string, model: string) => {
  const endpoint = { a: "http://swap:8080", b: "http://swap:8080", c: "http://other:1" }[
    instanceId
  ];
  return endpoint ? { endpoint, modelId: model } : undefined;
};

describe("modelSwapConflicts", () => {
  const base = {
    projectTitles: new Map([
      ["p1", "Alpha"],
      ["p2", "Beta"],
    ]),
    locate,
    endpoint: "http://swap:8080",
    loadedModel: "qwen",
  };

  it("groups live threads on the loaded model by project, matching by endpoint", () => {
    expect(
      modelSwapConflicts({
        ...base,
        threads: [
          thread("t1", { activeRunId: "r1" }),
          thread("t2", { instance: "b" }),
          thread("t3", { projectId: "p2" }),
          thread("archived", { archivedAt: "2026-01-01" }),
          thread("othermodel", { model: "gemma" }),
          thread("otherserver", { instance: "c" }),
          thread("self"),
        ],
        excludeThreadId: "self",
      }),
    ).toEqual([
      {
        projectId: "p1",
        projectTitle: "Alpha",
        threads: [
          { id: "t1", title: "t1", running: true },
          { id: "t2", title: "t2", running: false },
        ],
      },
      {
        projectId: "p2",
        projectTitle: "Beta",
        threads: [{ id: "t3", title: "t3", running: false }],
      },
    ]);
  });

  it("is empty when nothing uses the model", () => {
    expect(modelSwapConflicts({ ...base, threads: [] })).toEqual([]);
  });
});

describe("contextWarning", () => {
  it("compares the per-slot window with Claude's floor", () => {
    const claude = "claudeAgent";
    expect(contextWarning({ driver: claude, contextTokens: 16_384, slots: 1 })).toEqual({
      kind: "tooSmall",
      perSlotTokens: 16_384,
      floorTokens: 20_000,
    });
    expect(contextWarning({ driver: claude, contextTokens: 32_768, slots: 2 })).toEqual({
      kind: "tooSmall",
      perSlotTokens: 16_384,
      floorTokens: 20_000,
    });
    expect(contextWarning({ driver: claude, contextTokens: 65_536, slots: 1 })).toBeUndefined();
    expect(contextWarning({ driver: claude, contextTokens: undefined, slots: undefined })).toEqual({
      kind: "unknown",
    });
  });

  it("stays quiet for a provider with no measured floor", () => {
    expect(contextWarning({ driver: "codex", contextTokens: 1024, slots: 1 })).toBeUndefined();
  });
});

describe("locateLlamaSwapModel", () => {
  const snapshot = {
    auth: { endpoint: "http://claude:1" },
    subProviderEndpoints: { swap: "http://swap:8080" },
  };

  it("uses the upstream provider's endpoint and strips its prefix", () => {
    expect(locateLlamaSwapModel(snapshot, "swap/qwen")).toEqual({
      endpoint: "http://swap:8080",
      modelId: "qwen",
      subProvider: "swap",
    });
  });

  it("falls back to the instance endpoint with the whole slug", () => {
    expect(locateLlamaSwapModel(snapshot, "org/qwen")).toEqual({
      endpoint: "http://claude:1",
      modelId: "org/qwen",
    });
    expect(locateLlamaSwapModel({ auth: {} }, "qwen")).toBeUndefined();
  });
});

describe("planLlamaSwapSwitch", () => {
  const swapStatus = {
    supported: true,
    authFailed: false,
    running: [{ model: "qwen", state: "ready" as const }],
    models: [
      { id: "qwen", contextTokens: 65536 },
      { id: "gemma", contextTokens: 16384 },
      { id: "big", contextTokens: 131072 },
    ],
  };
  const thread = (id: string, projectId: string, model: string) => ({
    id,
    projectId,
    title: id,
    archivedAt: null,
    activeRunId: null,
    modelSelection: { instanceId: "a", model },
  });
  const base = {
    status: swapStatus,
    driver: "claudeAgent",
    endpoint: "http://swap",
    threads: [thread("t1", "p1", "qwen")],
    projectTitles: new Map([["p1", "Alpha"]]),
    locate: (_instance: string, model: string) => ({ endpoint: "http://swap", modelId: model }),
  };

  it("names who loses the loaded model and warns about a small window", () => {
    const plan = planLlamaSwapSwitch({ ...base, picked: "gemma" });
    expect(plan?.loadedModel).toBe("qwen");
    expect(plan?.conflicts.map((c) => c.projectTitle)).toEqual(["Alpha"]);
    expect(plan?.warning).toMatchObject({ kind: "tooSmall", perSlotTokens: 16384 });
  });

  it("needs no confirmation for the loaded model or a roomy, unshared switch", () => {
    expect(planLlamaSwapSwitch({ ...base, picked: "qwen" })).toBeNull();
    expect(planLlamaSwapSwitch({ ...base, picked: "big", threads: [] })).toBeNull();
  });

  it("plans an unload from the same conflicts", () => {
    expect(planLlamaSwapSwitch({ ...base, picked: null })?.conflicts).toHaveLength(1);
  });
});

const stageStatus = (running: Array<[string, "ready" | "starting" | "stopping"]>) => ({
  supported: true,
  authFailed: false,
  models: [],
  running: running.map(([model, state]) => ({ model, state })),
});

it("reports unloading first, then loading, and nothing once the model is ready", () => {
  expect(llamaSwapLoadStage(stageStatus([["old", "stopping"]]), "new")).toEqual({
    kind: "unloading",
    model: "old",
  });
  expect(llamaSwapLoadStage(stageStatus([["new", "starting"]]), "new")).toEqual({
    kind: "loading",
    model: "new",
  });
  expect(llamaSwapLoadStage(stageStatus([["new", "ready"]]), "new")).toBeNull();
  expect(llamaSwapLoadStage(stageStatus([]), "new")).toBeNull();
});
