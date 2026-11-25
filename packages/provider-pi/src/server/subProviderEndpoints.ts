import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Origin of each provider in Pi's `models.json` that sets its own `baseUrl`. */
export function piSubProviderEndpoints(modelsJson: unknown): Record<string, string> | undefined {
  const providers =
    typeof modelsJson === "object" && modelsJson !== null
      ? (modelsJson as { providers?: unknown }).providers
      : undefined;
  if (typeof providers !== "object" || providers === null) return undefined;
  const endpoints: Record<string, string> = {};
  for (const [name, config] of Object.entries(providers)) {
    const baseUrl =
      typeof config === "object" && config !== null
        ? (config as { baseUrl?: unknown }).baseUrl
        : undefined;
    const url = typeof baseUrl === "string" ? URL.parse(baseUrl) : null;
    if (url && /^https?:$/.test(url.protocol)) endpoints[name] = url.origin;
  }
  return Object.keys(endpoints).length === 0 ? undefined : endpoints;
}

/** Reads `models.json` from Pi's agent directory. Any failure means no endpoints. */
export const readPiSubProviderEndpoints = Effect.fn("readPiSubProviderEndpoints")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = environment.HOME ?? environment.USERPROFILE ?? "";
  const agentDir =
    environment.PI_CODING_AGENT_DIR?.trim() || (home ? path.join(home, ".pi", "agent") : "");
  if (!agentDir) return undefined;
  return yield* fileSystem.readFileString(path.join(agentDir, "models.json")).pipe(
    Effect.map((text) => piSubProviderEndpoints(JSON.parse(text))),
    Effect.orElseSucceed(() => undefined),
  );
});
