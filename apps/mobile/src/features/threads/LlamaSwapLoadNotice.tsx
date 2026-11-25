import { llamaSwapLoadStage, locateLlamaSwapModel } from "@t3tools/client-runtime/state/llamaSwap";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

/**
 * Shown while llama-swap unloads or loads a thread's model for a turn in flight. It subscribes
 * only while a turn is running, and shows the stage, elapsed time and the newest llama.cpp line.
 */
export function LlamaSwapLoadNotice(props: {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider | undefined;
  readonly model: string;
  readonly busy: boolean;
}) {
  const gt = useGT();
  const place = props.provider && locateLlamaSwapModel(props.provider, props.model);
  const query = useEnvironmentQuery(
    props.busy && props.provider && place
      ? serverEnvironment.llamaSwapStatus({
          environmentId: props.environmentId,
          input: {
            instanceId: props.provider.instanceId,
            ...(place.subProvider === undefined ? {} : { subProvider: place.subProvider }),
          },
        })
      : null,
  );
  const stage = query.data && place ? llamaSwapLoadStage(query.data, place.modelId) : null;
  const active = stage !== null;
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
  if (!stage || !query.data) return null;
  const detail = [gt("{seconds}s elapsed", { seconds: elapsed }), query.data.logLine]
    .filter(Boolean)
    .join(" · ");
  return (
    <View className="gap-1 px-4 pb-3">
      <AppText textRole="footnote" className="text-foreground">
        {stage.kind === "unloading"
          ? gt("Unloading {model}", { model: stage.model })
          : gt("Loading {model}", { model: stage.model })}
      </AppText>
      <AppText textRole="footnote" className="text-foreground-muted" numberOfLines={2}>
        {detail}
      </AppText>
    </View>
  );
}
