import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { sweepSwappedOut } from "./swapSweep.ts";

const thread = (id: string, model: string, instanceId = "a") => ({
  id: id as ThreadId,
  projectId: "p" as ProjectId,
  instanceId,
  model,
});
const status = (running: Array<[string, "ready" | "starting"]>, supported = true) => ({
  supported,
  authFailed: false,
  running: running.map(([model, state]) => ({ model, state })),
  models: [{ id: "qwen" }, { id: "gemma" }],
});

it("reports a displaced thread once and again only after its model returns", () => {
  const notified = new Set<string>();
  const run = (s: ReturnType<typeof status>) =>
    sweepSwappedOut({
      threads: [thread("t1", "qwen")],
      statusByInstance: new Map([["a", s]]),
      notified,
    });
  expect(run(status([["gemma", "ready"]]))).toEqual([
    { threadId: "t1", projectId: "p", previousModel: "qwen", loadedModel: "gemma" },
  ]);
  expect(run(status([["gemma", "ready"]]))).toEqual([]);
  expect(run(status([["qwen", "ready"]]))).toEqual([]);
  expect(run(status([["gemma", "ready"]]))).toHaveLength(1);
});

it("ignores idle servers, unknown models, other servers and unsupported endpoints", () => {
  const notified = new Set<string>();
  const sweep = (threads: Array<ReturnType<typeof thread>>, s: ReturnType<typeof status>) =>
    sweepSwappedOut({ threads, statusByInstance: new Map([["a", s]]), notified });
  expect(sweep([thread("t", "qwen")], status([]))).toEqual([]);
  expect(sweep([thread("t", "other")], status([["gemma", "ready"]]))).toEqual([]);
  expect(sweep([thread("t", "qwen", "b")], status([["gemma", "ready"]]))).toEqual([]);
  expect(sweep([thread("t", "qwen")], status([["gemma", "ready"]], false))).toEqual([]);
  expect(sweep([thread("t", "qwen")], status([["gemma", "starting"]]))).toEqual([]);
});
