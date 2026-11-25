import { expect, it } from "vite-plus/test";

import { planLlamaSwapSwitch } from "./llamaSwapSwitch";

const status = {
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
  status,
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
