import type { ObjectSchema } from "./capability.js";

export interface ParamValidationError {
  field: string;
  problem: string;
}

/**
 * Validates runtime input-parameter VALUES against a capability's declared
 * inputSchema. Deliberately hand-written rather than dynamically reconstructing
 * a Zod schema from the JSON-Schema-like ObjectSchema: the shape is simple
 * (flat string/number/boolean fields), so a small direct check is more
 * legible than a dynamic-schema-building layer.
 */
export function validateParams(
  schema: ObjectSchema,
  params: Record<string, unknown>,
): ParamValidationError[] {
  const errors: ParamValidationError[] = [];

  for (const field of schema.required) {
    if (!(field in params) || params[field] === undefined || params[field] === null) {
      errors.push({ field, problem: "required field is missing" });
    }
  }

  for (const [field, value] of Object.entries(params)) {
    const fieldSchema = schema.properties[field];
    if (!fieldSchema) {
      errors.push({ field, problem: "not a declared input parameter" });
      continue;
    }
    if (value === undefined || value === null) continue;
    const actualType = typeof value;
    if (actualType !== fieldSchema.type) {
      errors.push({
        field,
        problem: `expected ${fieldSchema.type}, got ${actualType}`,
      });
    }
  }

  return errors;
}
