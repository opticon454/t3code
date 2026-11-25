import { msg } from "gt-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";

import { m } from "../i18n/messages";
import { liveShellEnvironmentIdsAtom } from "../state/shell";
import { environmentThreadShells } from "../state/threads";
import { environmentProjects } from "../state/projects";
import { serverEnvironment } from "../state/server";
import { toastManager } from "./ui/toast";

/**
 * Toasts when another client's request makes llama-swap replace a model one of this machine's
 * threads was using. The server sweeps every 20 seconds and reports each displacement once.
 */
export function startLlamaSwapSwapNotices(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  const subscriptions = new Map<EnvironmentId, () => void>();

  const watch = (environmentId: EnvironmentId) =>
    registry.subscribe(
      serverEnvironment.llamaSwapSwapEvents({ environmentId, input: {} }),
      (result) => {
        if (result._tag !== "Success") return;
        for (const event of result.value) {
          const thread = registry
            .get(environmentThreadShells.quietThreadShellsAtom)
            .find(
              (candidate) =>
                candidate.environmentId === environmentId && candidate.id === event.threadId,
            );
          const project = registry
            .get(environmentProjects.environmentProjectsAtom(environmentId))
            .find((candidate) => candidate.id === event.projectId);
          toastManager.add({
            type: "warning",
            title: m(
              msg("{thread} in {project} lost {previous}: llama-swap loaded {loaded}", {
                thread: thread?.title ?? event.threadId,
                project: project?.title ?? event.projectId,
                previous: event.previousModel,
                loaded: event.loadedModel,
              }),
            ),
            actionProps: {
              children: m(msg("Open thread")),
              onClick: () => {
                void router.navigate({
                  to: "/$environmentId/$threadId",
                  params: { environmentId, threadId: event.threadId },
                });
              },
            },
          });
        }
      },
    );

  const sync = () => {
    const live = registry.get(liveShellEnvironmentIdsAtom);
    for (const [environmentId, stop] of subscriptions) {
      if (live.has(environmentId)) continue;
      stop();
      subscriptions.delete(environmentId);
    }
    for (const environmentId of live) {
      if (!subscriptions.has(environmentId)) subscriptions.set(environmentId, watch(environmentId));
    }
  };

  const stopSync = registry.subscribe(liveShellEnvironmentIdsAtom, sync);
  sync();
  return () => {
    stopSync();
    for (const stop of subscriptions.values()) stop();
    subscriptions.clear();
  };
}
