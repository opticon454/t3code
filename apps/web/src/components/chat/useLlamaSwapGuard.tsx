import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId, LlamaSwapStatus, ProviderInstanceId } from "@t3tools/contracts";
import { useContext, useState } from "react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { environmentProjects } from "../../state/projects";
import { environmentThreadShells } from "../../state/threads";
import { type LlamaSwapConfirmation } from "./LlamaSwapConfirmDialog";
import { locateLlamaSwapModel } from "@t3tools/client-runtime/state/llamaSwap";
import { planLlamaSwapSwitch } from "./llamaSwapSwitch";

/**
 * Confirms a pick or unload that would unload another model other threads use, or whose
 * context is below the provider's floor. Reads threads on demand, so it adds no subscription.
 */
export function useLlamaSwapGuard(
  environmentId: EnvironmentId | null,
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>,
) {
  const registry = useContext(RegistryContext);
  const [confirmation, setConfirmation] = useState<LlamaSwapConfirmation | null>(null);

  /** Runs `proceed` now, or after the viewer confirms. `picked` is null for an unload. */
  const guard = (input: {
    instanceId: ProviderInstanceId;
    status: LlamaSwapStatus;
    model: string;
    kind: "pick" | "unload";
    proceed: () => void;
  }) => {
    const entry = instanceEntries.find((candidate) => candidate.instanceId === input.instanceId);
    const place = entry && locateLlamaSwapModel(entry.snapshot, input.model);
    if (!entry || !place || environmentId === null) return input.proceed();
    const locate = (instanceId: string, model: string) => {
      const snapshot = instanceEntries.find(
        (candidate) => candidate.instanceId === instanceId,
      )?.snapshot;
      return snapshot && locateLlamaSwapModel(snapshot, model);
    };
    const threads = registry
      .get(environmentThreadShells.quietThreadShellsAtom)
      .filter((thread) => thread.environmentId === environmentId)
      .map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        archivedAt: thread.archivedAt,
        activeRunId: thread.runtime?.activeRunId ?? null,
        modelSelection: {
          instanceId: thread.modelSelection.instanceId,
          model: thread.modelSelection.model,
        },
      }));
    const projectTitles = new Map<string, string>(
      registry
        .get(environmentProjects.environmentProjectsAtom(environmentId))
        .map((project) => [project.id, project.title]),
    );
    const plan = planLlamaSwapSwitch({
      status: input.status,
      driver: entry.driverKind,
      picked: input.kind === "unload" ? null : place.modelId,
      ...(input.kind === "unload" ? { unloadModel: place.modelId } : {}),
      endpoint: place.endpoint,
      threads,
      projectTitles,
      locate,
    });
    if (!plan) return input.proceed();
    setConfirmation({ kind: input.kind, model: input.model, plan, proceed: input.proceed });
  };

  return { guard, confirmation, closeConfirmation: () => setConfirmation(null) };
}
