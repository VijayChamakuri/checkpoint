import { describe, expect, it } from "vitest";
import { redactField, redactDeep } from "../../src/logging/redact.js";

describe("redactField", () => {
  it("redacts a field whose name matches the denylist", () => {
    expect(redactField("ssn", "123-45-6789")).toBe("[REDACTED:ssn]");
    expect(redactField("password", "hunter2")).toBe("[REDACTED:password]");
  });

  it("allowlists memberId even though it looks sensitive-adjacent", () => {
    expect(redactField("memberId", "10023")).toBe("10023");
  });

  it("redacts an SSN-shaped value even in an unexpected field", () => {
    expect(redactField("notes", "call 123-45-6789 back")).toBe("[REDACTED:notes]");
  });

  it("leaves ordinary values alone", () => {
    expect(redactField("balance", "$4210.55")).toBe("$4210.55");
  });

  it("does not redact a runId even though its 13-digit timestamp is card-number-shaped", () => {
    // Regression: Date.now()-based run IDs are structurally indistinguishable
    // from an unformatted 13-digit card number to the regex backstop alone.
    expect(redactField("runId", "discover-1789275132909")).toBe("discover-1789275132909");
  });
});

describe("redactDeep", () => {
  it("redacts nested fields recursively", () => {
    const input = { user: { memberId: "10023", ssn: "123-45-6789" }, note: "fine" };
    const result = redactDeep(input);
    expect(result.user.memberId).toBe("10023");
    expect(result.user.ssn).toBe("[REDACTED:ssn]");
    expect(result.note).toBe("fine");
  });

  it("redacts through arrays", () => {
    const input = [{ token: "sk-abcdefghij1234567890" }];
    const result = redactDeep(input);
    expect(result[0]?.token).toBe("[REDACTED:token]");
  });
});
