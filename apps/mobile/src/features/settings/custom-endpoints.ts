import {
  CustomModelEndpointConfig,
  CustomModelEndpointId,
  type CustomModelEndpointAuthHeader,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface CustomEndpointDraft {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly contextTokens: string;
  readonly apiKey: string;
  readonly authHeader: CustomModelEndpointAuthHeader;
  readonly apiVersion: string;
  readonly defaultModel: string;
}

const decodeConfig = Schema.decodeUnknownOption(CustomModelEndpointConfig);
const decodeId = Schema.decodeUnknownOption(CustomModelEndpointId);

export const EMPTY_ENDPOINT_DRAFT: CustomEndpointDraft = {
  id: "",
  label: "",
  baseUrl: "",
  contextTokens: "",
  apiKey: "",
  authHeader: "authorization-bearer",
  apiVersion: "",
  defaultModel: "",
};

export function draftFromEndpoint(
  id: string,
  config: CustomModelEndpointConfig,
): CustomEndpointDraft {
  return {
    id,
    label: config.label ?? "",
    baseUrl: config.baseUrl,
    contextTokens: config.contextTokens?.toString() ?? "",
    // A saved key is never shown; a blank field keeps it.
    apiKey: "",
    authHeader: config.authHeader,
    apiVersion: config.apiVersion ?? "",
    defaultModel: config.defaultModel ?? "",
  };
}

/**
 * The patch entry for a draft, or null when it is not valid yet. A blank key on an edit sends the
 * redaction marker the server gave us, which keeps the saved key.
 */
export function planCustomEndpointSave(input: {
  readonly draft: CustomEndpointDraft;
  readonly existing: CustomModelEndpointConfig | undefined;
  readonly takenIds: ReadonlyArray<string>;
}): { readonly id: CustomModelEndpointId; readonly config: CustomModelEndpointConfig } | null {
  const { draft, existing } = input;
  const id = decodeId(draft.id.trim());
  if (Option.isNone(id)) return null;
  if (existing === undefined && input.takenIds.includes(draft.id.trim())) return null;
  const typedKey = draft.apiKey.trim();
  const apiKey =
    typedKey !== "" ? typedKey : typeof existing?.apiKey === "string" ? existing.apiKey : "";
  const context = draft.contextTokens.trim();
  const config = decodeConfig({
    ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
    baseUrl: draft.baseUrl.trim(),
    ...(context === "" ? {} : { contextTokens: Number(context) }),
    apiKey,
    authHeader: draft.authHeader,
    ...(draft.apiVersion.trim() ? { apiVersion: draft.apiVersion.trim() } : {}),
    ...(draft.defaultModel.trim() ? { defaultModel: draft.defaultModel.trim() } : {}),
  });
  return Option.isSome(config) ? { id: id.value, config: config.value } : null;
}
