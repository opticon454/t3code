import { describe, expect, it } from "vite-plus/test";

import { contextWarning, modelSwapConflicts, type SwapThread } from "./llamaSwap.ts";

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

const endpointOf = (instanceId: string) =>
  ({ a: "http://swap:8080", b: "http://swap:8080", c: "http://other:1" })[instanceId];

describe("modelSwapConflicts", () => {
  const base = {
    projectTitles: new Map([
      ["p1", "Alpha"],
      ["p2", "Beta"],
    ]),
    endpointOf,
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
      floorTokens: 40_000,
    });
    expect(contextWarning({ driver: claude, contextTokens: 65_536, slots: 2 })).toEqual({
      kind: "tooSmall",
      perSlotTokens: 32_768,
      floorTokens: 40_000,
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
