/** Origin of each connected OpenCode provider that sets its own `options.baseURL`. */
export function openCodeSubProviderEndpoints(
  providers: ReadonlyArray<{
    readonly id: string;
    readonly options?: { readonly [key: string]: unknown };
  }>,
  connected: ReadonlyArray<string>,
): Record<string, string> | undefined {
  const endpoints: Record<string, string> = {};
  for (const provider of providers) {
    const baseUrl = provider.options?.baseURL;
    const url = typeof baseUrl === "string" ? URL.parse(baseUrl) : null;
    if (connected.includes(provider.id) && url && /^https?:$/.test(url.protocol)) {
      endpoints[provider.id] = url.origin;
    }
  }
  return Object.keys(endpoints).length === 0 ? undefined : endpoints;
}
