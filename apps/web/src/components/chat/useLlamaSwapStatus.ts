import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, LlamaSwapStatus, ProviderInstanceId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { useMessages } from "gt-react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

export type LlamaSwapLoadState = "ready" | "starting" | "stopping";

export interface LlamaSwapView {
  readonly status: LlamaSwapStatus;
  readonly canUnload: boolean;
  readonly unload: (model: string) => void;
}

/**
 * Live llama-swap state for the instance the picker is showing. It subscribes only while this
 * is mounted, and only for an instance with a custom endpoint. The view is null when that
 * endpoint is not llama-swap or rejected the key, which `authFailed` reports.
 */
export function useLlamaSwapStatus(
  environmentId: EnvironmentId | null,
  entry: ProviderInstanceEntry | undefined,
  /** The upstream provider id, for OpenCode and Pi. */
  subProvider?: string,
): { readonly view: LlamaSwapView | null; readonly authFailed: boolean } {
  const watched =
    environmentId !== null &&
    entry !== undefined &&
    (subProvider === undefined
      ? entry.snapshot.auth.endpoint !== undefined
      : entry.snapshot.subProviderEndpoints?.[subProvider] !== undefined);
  const query = useEnvironmentQuery(
    watched
      ? serverEnvironment.llamaSwapStatus({
          environmentId,
          input: {
            instanceId: entry.instanceId,
            ...(subProvider === undefined ? {} : { subProvider }),
          },
        })
      : null,
    useMessages(),
  );
  const canUnload = useAtomValue(
    serverEnvironment.unloadLlamaSwapModel.permissionAtom(environmentId),
  );
  const unloadCommand = useAtomCommand(serverEnvironment.unloadLlamaSwapModel);
  const authFailed = watched && query.data?.authFailed === true;
  if (!watched || !query.data?.supported) return { view: null, authFailed };
  return {
    authFailed: false,
    view: {
      status: query.data,
      canUnload,
      unload: (model) =>
        void unloadCommand({
          environmentId,
          input: {
            instanceId: entry.instanceId,
            ...(subProvider === undefined ? {} : { subProvider }),
            model,
          },
        }),
    },
  };
}

/** The key of one llama-swap server in `useLlamaSwapStatuses`: an instance, or its upstream provider. */
export const llamaSwapStatusKey = (instanceId: string, subProvider?: string) =>
  `${instanceId}\0${subProvider ?? ""}`;

interface StatusTarget {
  readonly instanceId: string;
  readonly subProvider?: string;
}

const statusesAtom = Atom.family((key: string) =>
  Atom.make((get): ReadonlyMap<string, LlamaSwapStatus> => {
    const { environmentId, targets } = JSON.parse(key) as {
      environmentId: EnvironmentId;
      targets: ReadonlyArray<StatusTarget>;
    };
    const statuses = new Map<string, LlamaSwapStatus>();
    for (const target of targets) {
      const status = AsyncResult.getOrElse(
        get(
          serverEnvironment.llamaSwapStatus({
            environmentId,
            input: {
              instanceId: target.instanceId as ProviderInstanceId,
              ...(target.subProvider === undefined ? {} : { subProvider: target.subProvider }),
            },
          }),
        ),
        () => null,
      );
      if (status?.supported)
        statuses.set(llamaSwapStatusKey(target.instanceId, target.subProvider), status);
    }
    return statuses;
  }),
);

/**
 * Live state of every llama-swap server behind the listed instances, so a row can show its own
 * server's state wherever it appears. Only an instance with a custom endpoint is watched.
 */
export function useLlamaSwapStatuses(
  environmentId: EnvironmentId | null,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyMap<string, LlamaSwapStatus> {
  const targets = entries.flatMap((entry): Array<StatusTarget> => [
    ...(entry.snapshot.auth.endpoint ? [{ instanceId: entry.instanceId }] : []),
    ...Object.keys(entry.snapshot.subProviderEndpoints ?? {}).map((subProvider) => ({
      instanceId: entry.instanceId,
      subProvider,
    })),
  ]);
  return useAtomValue(
    statusesAtom(JSON.stringify({ environmentId, targets: environmentId ? targets : [] })),
  );
}
