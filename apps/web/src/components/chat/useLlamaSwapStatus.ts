import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, LlamaSwapStatus } from "@t3tools/contracts";
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
