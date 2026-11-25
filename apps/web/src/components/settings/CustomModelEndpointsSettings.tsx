import {
  type CustomEndpointModel,
  type CustomModelEndpointAuthHeader,
  CustomModelEndpointConfig,
  CustomModelEndpointId,
  type EnvironmentId,
  isSecretReference,
  type SecretReference,
} from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { MoreVertical, PlusIcon } from "lucide-react";
import { useState } from "react";
import { T, useGT, Var } from "gt-react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
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
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";
import { useSearchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const decodeEndpoint = Schema.decodeUnknownOption(CustomModelEndpointConfig);
const decodeEndpointId = Schema.decodeUnknownOption(CustomModelEndpointId);

type Saved = { readonly id: CustomModelEndpointId; readonly config: CustomModelEndpointConfig };
type Editing = Saved | "new";

const AUTH_HEADERS: ReadonlyArray<CustomModelEndpointAuthHeader> = [
  "authorization-bearer",
  "api-key",
  "x-api-key",
  "basic",
];

/** Rows that list, add, edit and remove one environment's custom model endpoints. */
export function CustomModelEndpointsSettings({
  environmentId,
  environmentLabel,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly readOnly: boolean;
}) {
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<CustomModelEndpointId | null>(null);
  const endpoints = Object.entries(settings.customModelEndpoints) as Array<
    [CustomModelEndpointId, CustomModelEndpointConfig]
  >;
  const removingConfig = removing === null ? undefined : settings.customModelEndpoints[removing];

  return (
    <>
      <SettingsSection
        {...setting("custom-model-endpoints")}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="outline" onClick={() => setEditing("new")}>
              <PlusIcon className="size-3" aria-hidden />
              <T>Add endpoint</T>
            </Button>
          ) : null
        }
      >
        {endpoints.length === 0 ? (
          <SettingsRow
            title={gt("No custom model endpoints yet")}
            description={gt(
              "Add a model server, such as llama-swap or an Azure deployment. Choose it on a provider instance to send that instance's requests there.",
            )}
          />
        ) : null}
        {endpoints.map(([id, config]) => (
          <SettingsRow
            key={id}
            title={config.label ?? id}
            description={config.baseUrl.replace(/^https?:\/\//, "")}
            control={
              readOnly ? null : (
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost-muted"
                        aria-label={gt("More actions for {name}", { name: config.label ?? id })}
                      />
                    }
                  >
                    <MoreVertical />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem onClick={() => setEditing({ id, config })}>
                      <T>Edit</T>
                    </MenuItem>
                    <MenuItem variant="destructive" onClick={() => setRemoving(id)}>
                      <T>Remove</T>
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              )
            }
          />
        ))}
      </SettingsSection>
      {editing !== null ? (
        <EndpointDialog
          environmentId={environmentId}
          editing={editing}
          takenIds={Object.keys(settings.customModelEndpoints)}
          onClose={() => setEditing(null)}
          onSave={(id, config) => updateSettings({ customModelEndpoints: { [id]: config } })}
        />
      ) : null}
      <AlertDialog
        open={removingConfig !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>
                Remove <Var>{removingConfig?.label ?? removing ?? ""}</Var>?
              </T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>
                This deletes the API key stored on <Var>{environmentLabel}</Var>. Provider instances
                that use this endpoint go back to their own settings.
              </T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (removing !== null) {
                  updateSettings({ customModelEndpoints: { [removing]: null } });
                }
                setRemoving(null);
              }}
            >
              <T>Remove</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function authHeaderLabel(
  header: CustomModelEndpointAuthHeader,
  gt: ReturnType<typeof useGT>,
): string {
  switch (header) {
    case "api-key":
      return gt("api-key (Azure OpenAI)");
    case "x-api-key":
      return gt("x-api-key");
    case "basic":
      return gt("Basic");
    default:
      return gt("Authorization: Bearer (default)");
  }
}

function EndpointDialog({
  environmentId,
  editing,
  takenIds,
  onClose,
  onSave,
}: {
  readonly environmentId: EnvironmentId;
  readonly editing: Editing;
  readonly takenIds: ReadonlyArray<string>;
  readonly onClose: () => void;
  readonly onSave: (id: CustomModelEndpointId, config: CustomModelEndpointConfig) => void;
}) {
  const gt = useGT();
  const existing = editing === "new" ? null : editing.config;
  const secretSources = useSecretSources(environmentId);
  const [id, setId] = useState<string>(editing === "new" ? "" : editing.id);
  const [label, setLabel] = useState(existing?.label ?? "");
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? "");
  const [contextTokens, setContextTokens] = useState(existing?.contextTokens?.toString() ?? "");
  const [authHeader, setAuthHeader] = useState<CustomModelEndpointAuthHeader>(
    existing?.authHeader ?? "authorization-bearer",
  );
  const [apiVersion, setApiVersion] = useState(existing?.apiVersion ?? "");
  const [defaultModel, setDefaultModel] = useState(existing?.defaultModel ?? "");
  const [keyDraft, setKeyDraft] = useState<string | SecretReference>(
    isSecretReference(existing?.apiKey) ? existing.apiKey : "",
  );
  const [keyValid, setKeyValid] = useState(true);
  const [models, setModels] = useState<ReadonlyArray<CustomEndpointModel>>([]);
  const [discovering, setDiscovering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A saved literal key arrives redacted; sending the marker back keeps it.
  const storedKey = typeof existing?.apiKey === "string" ? existing.apiKey : "";
  const apiKey = typeof keyDraft === "string" ? keyDraft.trim() || storedKey : keyDraft;
  const parsedContext = contextTokens.trim() === "" ? undefined : Number(contextTokens);
  const config = decodeEndpoint({
    ...(label.trim() ? { label: label.trim() } : {}),
    baseUrl: baseUrl.trim(),
    ...(parsedContext === undefined ? {} : { contextTokens: parsedContext }),
    apiKey,
    authHeader,
    ...(apiVersion.trim() ? { apiVersion: apiVersion.trim() } : {}),
    ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
  });
  const parsedId = decodeEndpointId(id.trim());
  const idTaken = editing === "new" && takenIds.includes(id.trim());
  const canSave = keyValid && Option.isSome(config) && Option.isSome(parsedId) && !idTaken;

  const discover = async () => {
    if (!Option.isSome(config) || !Option.isSome(parsedId) || discovering) return;
    setDiscovering(true);
    setMessage(null);
    const result = await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.listCustomEndpointModels,
      { environmentId, input: { id: parsedId.value, config: config.value } },
      { reportFailure: false },
    );
    setDiscovering(false);
    if (result._tag === "Success") {
      setModels(result.value);
      setMessage(
        gt("{count, plural, one {# model found} other {# models found}}", {
          count: result.value.length,
        }),
      );
    } else {
      setMessage(formatEnvironmentQueryError(result.cause));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {existing === null ? gt("Add custom model endpoint") : gt("Edit custom model endpoint")}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cme-id">
                <T>Id</T>
              </Label>
              <Input
                id="cme-id"
                value={id}
                disabled={existing !== null}
                placeholder="llama-swap"
                onChange={(event) => setId(event.target.value)}
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                <T>Short and stable. Lower case letters, numbers, - and _.</T>
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cme-label">
                <T>Label</T>
              </Label>
              <Input id="cme-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cme-url">
                <T>Base URL</T>
              </Label>
              <Input
                id="cme-url"
                value={baseUrl}
                placeholder="http://10.0.0.5:8080"
                onChange={(e) => setBaseUrl(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cme-context">
                <T>Default context length (tokens)</T>
              </Label>
              <Input
                id="cme-context"
                inputMode="numeric"
                value={contextTokens}
                placeholder="131072"
                onChange={(e) => setContextTokens(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <p className="text-xs text-muted-foreground">
                <T>
                  Used for models whose size cannot be discovered. It is the model&apos;s whole
                  window; the Claude floor check divides it by the slot count when one is known.
                  Leave empty to let each CLI assume its own default.
                </T>
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cme-key">
                <T>API key (optional)</T>
              </Label>
              <SecretSourceInput
                id="cme-key"
                aria-label={gt("API key")}
                value={keyDraft}
                configured={storedKey !== ""}
                sources={secretSources}
                onChange={(event) => setKeyDraft(event.target.value)}
                onSecretChange={(secret) => setKeyDraft(secret ?? "")}
                onValidityChange={setKeyValid}
              />
              <p className="text-xs text-muted-foreground">
                <T>Left blank on edit keeps the existing key.</T>
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cme-auth">
                <T>Auth header</T>
              </Label>
              <Select
                value={authHeader}
                onValueChange={(value) => {
                  if (value !== null) setAuthHeader(value as CustomModelEndpointAuthHeader);
                }}
              >
                <SelectTrigger id="cme-auth" aria-label={gt("Auth header")}>
                  <SelectValue>{authHeaderLabel(authHeader, gt)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {AUTH_HEADERS.map((header) => (
                    <SelectItem key={header} value={header}>
                      {authHeaderLabel(header, gt)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <p className="text-xs text-muted-foreground">
                <T>Never sends two headers. Some servers hang if you do.</T>
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cme-api-version">
                <T>API version (Azure only)</T>
              </Label>
              <Input
                id="cme-api-version"
                value={apiVersion}
                placeholder="2024-10-21"
                onChange={(e) => setApiVersion(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cme-default-model">
                <T>Default model</T>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="cme-default-model"
                  list="cme-models"
                  value={defaultModel}
                  placeholder={gt("No default (the provider picks its own)")}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  spellCheck={false}
                />
                <datalist id="cme-models">
                  {models.map((model) => (
                    <option key={model.id} value={model.id} />
                  ))}
                </datalist>
                <Button
                  variant="outline"
                  disabled={!canSave || discovering}
                  onClick={() => void discover()}
                >
                  {discovering ? gt("Discovering…") : gt("Discover models")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {message ?? <T>What new threads on an instance using this endpoint start with.</T>}
              </p>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <T>Cancel</T>
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              if (!Option.isSome(config) || !Option.isSome(parsedId)) return;
              onSave(parsedId.value, config.value);
              onClose();
            }}
          >
            <T>Save</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
