import * as Schema from "effect/Schema";

// Separate module avoids an import cycle between settings and provider-instance contracts.
export const CustomModelEndpointId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,63}$/)),
  Schema.brand("CustomModelEndpointId"),
);
export type CustomModelEndpointId = typeof CustomModelEndpointId.Type;
