import { z } from "zod";

/**
 * A capability is a typed, versioned, agent-invocable contract, not a raw
 * recording. inputSchema/outputSchema are a small JSON-Schema-like shape
 * (not a Zod object) specifically so the artifact stays plain, serializable
 * JSON a human or another system can read without a Zod runtime -- Zod is
 * only used to validate the STRUCTURE of the artifact file itself.
 */

export const paramRefSchema = z.object({ paramRef: z.string().min(1) });
export type ParamRef = z.infer<typeof paramRefSchema>;

export function isParamRef(value: unknown): value is ParamRef {
  return typeof value === "object" && value !== null && "paramRef" in value;
}

const stringOrParamRef = z.union([z.string(), paramRefSchema]);

export const fieldSchemaSchema = z.object({
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().optional(),
});
export type FieldSchema = z.infer<typeof fieldSchemaSchema>;

export const objectSchemaSchema = z.object({
  type: z.literal("object"),
  properties: z.record(fieldSchemaSchema),
  required: z.array(z.string()),
});
export type ObjectSchema = z.infer<typeof objectSchemaSchema>;

export const locatorSchema = z.object({
  role: z.string().min(1),
  name: z.string(),
  framePath: z.array(z.string()),
  structuralPath: z.array(z.string()),
  textMatch: stringOrParamRef.optional(),
  fallbackCoordinate: z.object({ x: z.number(), y: z.number() }),
});
export type Locator = z.infer<typeof locatorSchema>;

export const stepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("click"), locator: locatorSchema }),
  z.object({ action: z.literal("type"), locator: locatorSchema, value: stringOrParamRef }),
  z.object({ action: z.literal("navigate"), url: stringOrParamRef }),
  z.object({ action: z.literal("waitFor"), locator: locatorSchema, timeoutMs: z.number().optional() }),
  z.object({
    action: z.literal("read"),
    locator: locatorSchema,
    extract: z.object({
      field: z.string(),
      from: z.enum(["text", "attribute"]),
      attribute: z.string().optional(),
    }),
  }),
]);
export type Step = z.infer<typeof stepSchema>;

export const checkpointSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("element-visible"), locator: locatorSchema }),
  z.object({ type: z.literal("text-present"), text: stringOrParamRef }),
  z.object({ type: z.literal("url-matches"), pattern: z.string() }),
  z.object({
    type: z.literal("field-equals"),
    field: z.string(),
    from: z.enum(["text", "attribute"]),
    attribute: z.string().optional(),
    locator: locatorSchema,
    expectedValue: stringOrParamRef,
  }),
]);
export type Checkpoint = z.infer<typeof checkpointSchema>;

export const capabilitySchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string(),
  target: z.object({ app: z.string(), entryUrl: z.string() }),
  inputSchema: objectSchemaSchema,
  outputSchema: objectSchemaSchema,
  steps: z.array(stepSchema).min(1),
  checkpoint: checkpointSchema,
  createdAt: z.string(),
  sourceRunId: z.string(),
});
export type Capability = z.infer<typeof capabilitySchema>;
