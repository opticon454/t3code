import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { locateLlamaSwapModel, planLlamaSwapSwitch } from "@t3tools/client-runtime/state/llamaSwap";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useContext } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { environmentProjects } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ModelRowProps } from "./ThreadSettingsRows.shared";

/**
 * llama-swap state for one model row, plus a confirm step for a pick or unload that would
 * unload a model other threads use. Rows on one server share a single status subscription.
 */
export function useLlamaSwapRow(input: {
  environmentId: EnvironmentId | null;
  instanceId: ProviderInstanceId;
  model: string;
  driver: string;
}) {
  const gt = useGT();
  const registry = useContext(RegistryContext);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const providers = input.environmentId ? (configs.get(input.environmentId)?.providers ?? []) : [];
  const snapshot = providers.find((provider) => provider.instanceId === input.instanceId);
  const place = snapshot && locateLlamaSwapModel(snapshot, input.model);
  const query = useEnvironmentQuery(
    input.environmentId && place
      ? serverEnvironment.llamaSwapStatus({
          environmentId: input.environmentId,
          input: {
            instanceId: input.instanceId,
            ...(place.subProvider === undefined ? {} : { subProvider: place.subProvider }),
          },
        })
      : null,
  );
  const canUnload = useAtomValue(
    serverEnvironment.unloadLlamaSwapModel.permissionAtom(input.environmentId),
  );
  const unload = useAtomCommand(serverEnvironment.unloadLlamaSwapModel);
  const status = query.data;
  if (!status?.supported || !place || !input.environmentId) {
    return { llamaSwap: undefined, confirmPick: (proceed: () => void) => proceed() };
  }
  const environmentId = input.environmentId;
  const loaded = status.running.find((entry) => entry.model === place.modelId);
  const state = loaded && loaded.state !== "unknown" ? loaded.state : undefined;
  const listedContext = status.models.find((entry) => entry.id === place.modelId)?.contextTokens;
  const contextTokens =
    loaded?.contextTokens !== undefined && loaded.slots
      ? Math.floor(loaded.contextTokens / loaded.slots)
      : (loaded?.contextTokens ?? listedContext);

  const plan = (kind: "pick" | "unload") => {
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
    return planLlamaSwapSwitch({
      status,
      driver: input.driver,
      picked: kind === "unload" ? null : place.modelId,
      ...(kind === "unload" ? { unloadModel: place.modelId } : {}),
      endpoint: place.endpoint,
      threads,
      projectTitles: new Map(
        registry
          .get(environmentProjects.environmentProjectsAtom(environmentId))
          .map((project) => [project.id, project.title]),
      ),
      locate: (instanceId, model) => {
        const other = providers.find((provider) => provider.instanceId === instanceId);
        return other && locateLlamaSwapModel(other, model);
      },
    });
  };

  const describe = (
    kind: "pick" | "unload",
  ): { message: string; plan: ReturnType<typeof plan> } => {
    const result = plan(kind);
    if (!result) return { message: "", plan: result };
    const lines: Array<string> = [];
    for (const project of result.conflicts) {
      lines.push(
        gt("{project}: {count, plural, one {# thread} other {# threads}}, {running} running", {
          project: project.projectTitle,
          count: project.threads.length,
          running: project.threads.filter((thread) => thread.running).length,
        }),
      );
    }
    if (result.warning) {
      lines.push(
        result.warning.kind === "unknown"
          ? gt(
              "{model} does not report its context size, so it may be too small for Claude Code.",
              {
                model: place.modelId,
              },
            )
          : gt(
              "Claude Code needs about {floor} tokens per request; {model} has {size} per slot. Raise its context size in llama-swap's config.",
              {
                floor: result.warning.floorTokens.toLocaleString(),
                model: place.modelId,
                size: result.warning.perSlotTokens.toLocaleString(),
              },
            ),
      );
    }
    return { message: lines.join("\n"), plan: result };
  };

  const runUnload = () =>
    void unload({
      environmentId,
      input: {
        instanceId: input.instanceId,
        ...(place.subProvider === undefined ? {} : { subProvider: place.subProvider }),
        model: place.modelId,
      },
    });

  return {
    llamaSwap: {
      ...(state ? { state } : {}),
      ...(contextTokens === undefined ? {} : { contextTokens }),
      ...(canUnload && state === "ready"
        ? {
            onUnload: () => {
              const { message, plan: result } = describe("unload");
              if (!result) return runUnload();
              Dialog.confirm({
                title: gt("Unload {model}?", { model: place.modelId }),
                message,
                confirmText: gt("Unload anyway"),
                destructive: true,
                onConfirm: runUnload,
              });
            },
          }
        : {}),
    } satisfies ModelRowProps["llamaSwap"],
    confirmPick: (proceed: () => void) => {
      const { message, plan: result } = describe("pick");
      if (!result) return proceed();
      Dialog.confirm({
        title: gt("Switch to {model}?", { model: place.modelId }),
        message,
        confirmText: result.warning ? gt("Use anyway") : gt("Switch"),
        onConfirm: proceed,
      });
    },
  };
}
