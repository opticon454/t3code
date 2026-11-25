import { useGT } from "gt-react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import type { LlamaSwapSwitchPlan } from "./llamaSwapSwitch";

export interface LlamaSwapConfirmation {
  readonly kind: "pick" | "unload";
  readonly model: string;
  readonly plan: LlamaSwapSwitchPlan;
  readonly proceed: () => void;
}

/** Names who loses the loaded model and any context shortfall before a switch or unload. */
export function LlamaSwapConfirmDialog(props: {
  confirmation: LlamaSwapConfirmation | null;
  onClose: () => void;
}) {
  const gt = useGT();
  const confirmation = props.confirmation;
  const plan = confirmation?.plan;
  return (
    <AlertDialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <AlertDialogPopup>
        {confirmation && plan ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmation.kind === "unload"
                  ? gt("Unload {model}?", { model: confirmation.model })
                  : gt("Switch to {model}?", { model: confirmation.model })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {plan.conflicts.length === 0
                  ? null
                  : confirmation.kind === "unload"
                    ? gt("Unloading {loaded} affects threads that use it:", {
                        loaded: plan.loadedModel ?? "",
                      })
                    : gt("Sending to {model} unloads {loaded}, which these threads use:", {
                        model: confirmation.model,
                        loaded: plan.loadedModel ?? "",
                      })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 px-6 pb-4 text-sm">
              {plan.conflicts.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-5">
                  {plan.conflicts.map((project) => {
                    const running = project.threads.filter((thread) => thread.running).length;
                    return (
                      <li key={project.projectId}>
                        {gt(
                          "{project}: {count, plural, one {# thread} other {# threads}}, {running} running",
                          { project: project.projectTitle, count: project.threads.length, running },
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {plan.warning ? (
                <p className="text-warning-foreground">
                  {plan.warning.kind === "unknown"
                    ? gt(
                        "{model} does not report its context size, so it may be too small for Claude Code.",
                        { model: confirmation.model },
                      )
                    : gt(
                        "Claude Code needs about {floor} tokens per request; {model} has {size} per slot. Raise its context size in llama-swap's config.",
                        {
                          floor: plan.warning.floorTokens.toLocaleString(),
                          model: confirmation.model,
                          size: plan.warning.perSlotTokens.toLocaleString(),
                        },
                      )}
                </p>
              ) : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>
                {gt("Cancel")}
              </AlertDialogClose>
              <Button
                variant={confirmation.kind === "unload" ? "destructive" : "default"}
                onClick={() => {
                  confirmation.proceed();
                  props.onClose();
                }}
              >
                {confirmation.kind === "unload"
                  ? gt("Unload anyway")
                  : plan.warning
                    ? gt("Use anyway")
                    : gt("Switch")}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogPopup>
    </AlertDialog>
  );
}
