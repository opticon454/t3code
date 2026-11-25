import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { serverEnvironment } from "../../state/server";

/**
 * Tells the open thread's viewer that another client made llama-swap replace its model. The
 * server reports each displacement once; sending on the thread loads the model again.
 */
export function LlamaSwapSwapOutNotice(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const result = useAtomValue(
    serverEnvironment.llamaSwapSwapEvents({ environmentId: props.environmentId, input: {} }),
  );
  const [dismissed, setDismissed] = useState<unknown>(null);
  if (result._tag !== "Success" || dismissed === result.value) return null;
  const event = result.value.find((candidate) => candidate.threadId === props.threadId);
  if (!event) return null;
  return (
    <View className="gap-2 px-4 pb-3">
      <AppText textRole="footnote" className="text-foreground-muted">
        {gt(
          "This thread lost {previous}: llama-swap loaded {loaded}. Send a message to load it again.",
          {
            previous: event.previousModel,
            loaded: event.loadedModel,
          },
        )}
      </AppText>
      <Button label={gt("Dismiss")} onPress={() => setDismissed(result.value)} />
    </View>
  );
}
