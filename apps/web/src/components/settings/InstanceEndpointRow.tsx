import type {
  CustomModelEndpointId,
  EnvironmentId,
  ProviderInstanceConfig,
} from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";

const NONE = "__none__";
const ENDPOINT_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);

/** Chooses the saved custom model endpoint a provider instance sends its requests to. */
export function InstanceEndpointRow(props: {
  readonly environmentId: EnvironmentId;
  readonly instance: ProviderInstanceConfig;
  readonly onUpdate: (next: ProviderInstanceConfig) => void;
}) {
  const gt = useGT();
  const endpoints = useEnvironmentSettings(props.environmentId).customModelEndpoints;
  const entries = Object.entries(endpoints);
  const selected = props.instance.endpointId;
  if (!ENDPOINT_DRIVERS.has(props.instance.driver)) return null;
  if (entries.length === 0 && selected === undefined) return null;
  const labelOf = (id: string) => endpoints[id as CustomModelEndpointId]?.label ?? id;
  return (
    <SettingsRow
      title={gt("Custom model endpoint")}
      description={gt(
        "Sends this instance's requests to a saved endpoint, with its URL, key and auth header. Variables set below still win.",
      )}
      control={
        <Select
          value={selected ?? NONE}
          onValueChange={(value) => {
            if (value === null) return;
            const { endpointId: _drop, ...rest } = props.instance;
            props.onUpdate(
              value === NONE
                ? (rest as ProviderInstanceConfig)
                : ({
                    ...rest,
                    endpointId: value as CustomModelEndpointId,
                  } as ProviderInstanceConfig),
            );
          }}
        >
          <SelectTrigger aria-label={gt("Custom model endpoint")} size="sm" className="min-w-40">
            <SelectValue>{selected === undefined ? gt("None") : labelOf(selected)}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={NONE}>{gt("None")}</SelectItem>
            {entries.map(([id]) => (
              <SelectItem key={id} value={id}>
                {labelOf(id)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
