import type { LlamaSwapStatus, LlamaSwapSwapEvent } from "@t3tools/contracts";

export interface SweepThread {
  readonly id: LlamaSwapSwapEvent["threadId"];
  readonly projectId: LlamaSwapSwapEvent["projectId"];
  /** The llama-swap origin this thread's model is served from. */
  readonly origin: string;
  /** The model id llama-swap knows it by. */
  readonly model: string;
}

/**
 * Threads whose model another client displaced: llama-swap serves a different model now and
 * this thread's model is one it lists. `notified` holds one entry per displacement, so a
 * thread is reported once and again only after its model has been loaded again.
 */
export function sweepSwappedOut(input: {
  readonly threads: ReadonlyArray<SweepThread>;
  readonly statusByOrigin: ReadonlyMap<string, LlamaSwapStatus>;
  readonly notified: Set<string>;
}): ReadonlyArray<LlamaSwapSwapEvent> {
  const events: Array<LlamaSwapSwapEvent> = [];
  for (const thread of input.threads) {
    const status = input.statusByOrigin.get(thread.origin);
    if (!status?.supported) continue;
    const key = `${thread.id}\0${thread.model}`;
    if (status.running.some((entry) => entry.model === thread.model)) {
      input.notified.delete(key);
      continue;
    }
    const loaded = status.running.find((entry) => entry.state === "ready");
    if (!loaded || !status.models.some((entry) => entry.id === thread.model)) continue;
    if (input.notified.has(key)) continue;
    input.notified.add(key);
    events.push({
      threadId: thread.id,
      projectId: thread.projectId,
      previousModel: thread.model,
      loadedModel: loaded.model,
    });
  }
  return events;
}
