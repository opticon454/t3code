import type { LlamaSwapStatus } from "@t3tools/contracts";

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
