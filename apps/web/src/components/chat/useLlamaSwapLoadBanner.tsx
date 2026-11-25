import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { llamaSwapLoadStage } from "./llamaSwapLoadStage";
import { useLlamaSwapStatus } from "./useLlamaSwapStatus";

/** Whole seconds since `active` last became true. */
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a wall-clock interval is an external system
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [active]);
  return elapsed;
}

/**
 * A composer banner while llama-swap unloads or loads the thread's model for a turn in flight.
 * It subscribes only while a turn is busy. llama-swap reports no percentage, so it shows the
 * stage, the elapsed time and the newest llama.cpp line.
 */
export function useLlamaSwapLoadBanner(input: {
  environmentId: EnvironmentId | null;
  entry: ProviderInstanceEntry | undefined;
  model: string;
  busy: boolean;
}): ComposerBannerStackItem | null {
  const gt = useGT();
  const view = useLlamaSwapStatus(input.environmentId, input.busy ? input.entry : undefined);
  const stage = view ? llamaSwapLoadStage(view.status, input.model) : null;
  const elapsed = useElapsedSeconds(stage !== null);
  if (!view || !stage) return null;
  return {
    id: "llama-swap-load",
    variant: "info",
    group: "attention",
    icon: <LoaderIcon className="size-4" />,
    title:
      stage.kind === "unloading"
        ? gt("Unloading {model}", { model: stage.model })
        : gt("Loading {model}", { model: stage.model }),
    description: [gt("{seconds}s elapsed", { seconds: elapsed }), view.status.logLine]
      .filter(Boolean)
      .join(" · "),
  };
}
