import { describe, expect, it } from "vitest";
import { validateParams } from "../../src/schema/validate-params.js";
import type { ObjectSchema } from "../../src/schema/capability.js";

const schema: ObjectSchema = {
  type: "object",
  properties: { memberId: { type: "string" }, amount: { type: "number" } },
  required: ["memberId"],
};

describe("validateParams", () => {
  it("passes valid params", () => {
    expect(validateParams(schema, { memberId: "10023", amount: 5 })).toEqual([]);
  });

  it("flags a missing required field", () => {
    const errors = validateParams(schema, {});
    expect(errors).toContainEqual({ field: "memberId", problem: "required field is missing" });
  });

  it("flags a wrong type", () => {
    const errors = validateParams(schema, { memberId: 123 });
    expect(errors.some((e) => e.field === "memberId" && e.problem.includes("expected string"))).toBe(true);
  });

  it("flags an undeclared field", () => {
    const errors = validateParams(schema, { memberId: "1", extra: "nope" });
    expect(errors).toContainEqual({ field: "extra", problem: "not a declared input parameter" });
  });
});
