import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/schema/artifact-store.js";
import type { Capability } from "../../src/schema/capability.js";

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "lookup-member-balance",
    version: 1,
    name: "lookup-member-balance",
    description: "Look up a member and read their savings balance.",
    target: { app: "Member Services Console", entryUrl: "/search" },
    inputSchema: { type: "object", properties: { memberId: { type: "string" } }, required: ["memberId"] },
    outputSchema: { type: "object", properties: { balance: { type: "string" } }, required: ["balance"] },
    steps: [{ action: "navigate", url: "/search" }],
    checkpoint: { type: "url-matches", pattern: "/member/.*" },
    createdAt: new Date().toISOString(),
    sourceRunId: "discover-test",
    ...overrides,
  };
}

describe("ArtifactStore", () => {
  let dir: string;
  let store: ArtifactStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "artifact-store-test-"));
    store = new ArtifactStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and loads a valid capability", () => {
    const cap = makeCapability();
    const path = store.save(cap);
    expect(path).toContain("lookup-member-balance.v1.json");
    const loaded = store.load("lookup-member-balance");
    expect(loaded).toEqual(cap);
  });

  it("increments version on re-record instead of overwriting", () => {
    store.save(makeCapability({ version: 1 }));
    expect(store.nextVersion("lookup-member-balance")).toBe(2);
    store.save(makeCapability({ version: 2 }));
    const latest = store.load("lookup-member-balance");
    expect(latest.version).toBe(2);
    const v1 = store.load("lookup-member-balance", 1);
    expect(v1.version).toBe(1);
  });

  it("rejects a malformed capability with no partial write", () => {
    const malformed = makeCapability({ steps: [] });
    expect(() => store.save(malformed)).toThrow();
    expect(() => store.load("lookup-member-balance")).toThrow();
  });

  it("redacts a captured type step's literal value before it ever hits disk", () => {
    const cap = makeCapability({
      steps: [
        {
          action: "type",
          locator: { role: "textbox", name: "SSN", framePath: [], structuralPath: ["0"], fallbackCoordinate: { x: 0, y: 0 } },
          value: "123-45-6789",
        },
      ],
    });
    store.save(cap);
    const loaded = store.load("lookup-member-balance");
    const step = loaded.steps[0];
    expect(step?.action).toBe("type");
    expect(step?.action === "type" ? step.value : undefined).not.toBe("123-45-6789");
    expect(step?.action === "type" ? step.value : undefined).toContain("REDACTED");
  });

  it("leaves a paramRef-bound step value untouched, since it's not a literal capture", () => {
    const cap = makeCapability({
      steps: [
        {
          action: "type",
          locator: { role: "textbox", name: "Member ID", framePath: [], structuralPath: ["0"], fallbackCoordinate: { x: 0, y: 0 } },
          value: { paramRef: "memberId" },
        },
      ],
    });
    store.save(cap);
    const loaded = store.load("lookup-member-balance");
    const step = loaded.steps[0];
    expect(step?.action === "type" ? step.value : undefined).toEqual({ paramRef: "memberId" });
  });

  it("rejects a capability id that would escape the store directory", () => {
    expect(() => store.save(makeCapability({ id: "../../etc/passwd" }))).toThrow();
    expect(() => store.load("../../etc/passwd")).toThrow();
  });
});
