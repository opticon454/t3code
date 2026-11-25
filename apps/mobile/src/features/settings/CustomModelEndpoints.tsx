import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { CustomModelEndpointAuthHeader } from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";
import { useGT } from "gt-react-native";
import { useRef, useState } from "react";
import { TextInput, View } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { Menu } from "../../components/ui/Menu";
import { m } from "../../i18n/messages";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  type CustomEndpointDraft,
  draftFromEndpoint,
  EMPTY_ENDPOINT_DRAFT,
  planCustomEndpointSave,
} from "./custom-endpoints";
import type { SettingsTarget } from "./settings-environment-filter";

const AUTH_HEADERS: ReadonlyArray<CustomModelEndpointAuthHeader> = [
  "authorization-bearer",
  "api-key",
  "x-api-key",
  "basic",
];

function useEndpointPatch(environment: SettingsTarget) {
  const gt = useGT();
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(patch: Record<string, unknown>) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    const result = await update({
      environmentId: environment.environmentId,
      input: { patch: { customModelEndpoints: patch } as never },
    });
    pending.current = false;
    setBusy(false);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error
          ? (errorDisplayMessage(failure, m) ?? failure.message)
          : gt("Could not save the endpoint."),
      );
    }
    return false;
  }
  return { run, busy, error };
}

/** Lists, adds, edits and removes one environment's custom model endpoints. */
export function CustomModelEndpoints({ environment }: { readonly environment: SettingsTarget }) {
  const gt = useGT();
  const endpoints = environment.serverConfig.settings.customModelEndpoints;
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { run, busy, error } = useEndpointPatch(environment);
  const entries = Object.entries(endpoints);

  function remove(id: string, name: string) {
    Dialog.alert(
      gt("Remove {endpoint}?", { endpoint: name }),
      gt("This deletes the API key stored on {environment}.", { environment: environment.label }),
      [
        { text: gt("Cancel"), style: "cancel" },
        { text: gt("Remove"), style: "destructive", onPress: () => void run({ [id]: null }) },
      ],
    );
  }

  return (
    <View className="border-t border-border-subtle">
      {entries.map(([id, config]) => {
        const name = config.label ?? id;
        const actions: MenuAction[] = [
          { id: "edit", title: gt("Edit"), image: "pencil" },
          { id: "remove", title: gt("Remove"), image: "trash", attributes: { destructive: true } },
        ];
        return (
          <View key={id}>
            <View className="min-h-16 flex-row items-center gap-3 px-4 py-3">
              <View className="min-w-0 shrink grow gap-0.5">
                <Text textRole="body" className="text-foreground" numberOfLines={1}>
                  {name}
                </Text>
                <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
                  {config.baseUrl.replace(/^https?:\/\//, "")}
                </Text>
              </View>
              {editing === id ? null : (
                <Menu
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={gt("{endpoint} options", { endpoint: name })}
                  title={name}
                  actions={actions}
                  onPressAction={({ nativeEvent }) => {
                    if (busy) return;
                    if (nativeEvent.event === "edit") setEditing(id);
                    else if (nativeEvent.event === "remove") remove(id, name);
                  }}
                >
                  <ControlPill
                    icon="ellipsis"
                    accessibilityLabel={gt("{endpoint} options", { endpoint: name })}
                    disabled={busy}
                  />
                </Menu>
              )}
            </View>
            {editing === id ? (
              <EndpointForm
                environment={environment}
                initial={draftFromEndpoint(id, config)}
                onDone={() => setEditing(null)}
              />
            ) : null}
          </View>
        );
      })}
      {editing === "new" ? (
        <EndpointForm
          environment={environment}
          initial={EMPTY_ENDPOINT_DRAFT}
          onDone={() => setEditing(null)}
        />
      ) : (
        <ListActionRow
          icon="plus"
          label={gt("Add endpoint")}
          description={gt(
            "A model server such as llama-swap or an Azure deployment. Choose it on a provider instance on web or desktop.",
          )}
          onPress={() => setEditing("new")}
        />
      )}
      {error && editing === null ? (
        <Text accessibilityRole="alert" className="px-4 pb-3 text-danger-foreground">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function EndpointForm({
  environment,
  initial,
  onDone,
}: {
  readonly environment: SettingsTarget;
  readonly initial: CustomEndpointDraft;
  readonly onDone: () => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState(initial);
  const { run, busy, error } = useEndpointPatch(environment);
  const endpoints = environment.serverConfig.settings.customModelEndpoints;
  const isNew = initial.id === "";
  const plan = planCustomEndpointSave({
    draft,
    existing: isNew ? undefined : endpoints[initial.id as keyof typeof endpoints],
    takenIds: Object.keys(endpoints),
  });
  const headerLabel = (header: CustomModelEndpointAuthHeader) =>
    header === "api-key"
      ? gt("api-key (Azure OpenAI)")
      : header === "x-api-key"
        ? gt("x-api-key")
        : header === "basic"
          ? gt("Basic")
          : gt("Authorization: Bearer (default)");
  function field(
    key: keyof CustomEndpointDraft,
    label: string,
    placeholder: string,
    options: { secure?: boolean; numeric?: boolean; locked?: boolean } = {},
  ) {
    return (
      <TextInput
        accessibilityLabel={label}
        className="rounded-lg border border-border-subtle px-3 py-2 text-base text-foreground"
        placeholderTextColorClassName="accent-foreground-muted"
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={options.secure}
        keyboardType={options.numeric ? "number-pad" : "default"}
        editable={!busy && !options.locked}
        value={draft[key]}
        onChangeText={(value) => setDraft((current) => ({ ...current, [key]: value }))}
      />
    );
  }
  return (
    <View className="gap-2 px-4 py-3">
      {field("id", gt("Id"), gt("Id, e.g. llama-swap"), { locked: !isNew })}
      {field("label", gt("Label"), gt("Label"))}
      {field("baseUrl", gt("Base URL"), "http://10.0.0.5:8080")}
      {field(
        "contextTokens",
        gt("Default context length (tokens)"),
        gt("Default context, e.g. 131072"),
        {
          numeric: true,
        },
      )}
      {field(
        "apiKey",
        gt("API key"),
        isNew ? gt("API key (optional)") : gt("API key (unchanged if left blank)"),
        { secure: true },
      )}
      <Menu
        accessible
        accessibilityRole="button"
        accessibilityLabel={gt("Auth header")}
        title={gt("Auth header")}
        actions={AUTH_HEADERS.map((header) => ({ id: header, title: headerLabel(header) }))}
        onPressAction={({ nativeEvent }) =>
          setDraft((current) => ({
            ...current,
            authHeader: nativeEvent.event as CustomModelEndpointAuthHeader,
          }))
        }
      >
        <ControlPill variant="pill" label={headerLabel(draft.authHeader)} disabled={busy} />
      </Menu>
      {field("apiVersion", gt("API version (Azure only)"), "2024-10-21")}
      {field("defaultModel", gt("Default model"), gt("Default model (optional)"))}
      {error ? (
        <Text accessibilityRole="alert" className="text-danger-foreground">
          {error}
        </Text>
      ) : null}
      <View className="flex-row justify-end gap-2">
        <ControlPill variant="pill" label={gt("Cancel")} disabled={busy} onPress={onDone} />
        <ControlPill
          variant="primary"
          label={isNew ? gt("Add") : gt("Save")}
          disabled={busy || plan === null}
          onPress={() => {
            if (plan === null) return;
            void run({ [plan.id]: plan.config }).then((saved) => {
              if (saved) onDone();
            });
          }}
        />
      </View>
    </View>
  );
}
