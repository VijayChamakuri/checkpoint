import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStateStore, type RunState } from "../../src/escalation/run-state.js";

function makeState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run-1",
    capabilityId: "lookup-member-balance",
    phase: "discovery",
    stepIndex: 0,
    control: "agent",
    params: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RunStateStore", () => {
  let dir: string;
  let store: RunStateStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "run-state-test-"));
    store = new RunStateStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("redacts sensitive-shaped param values before writing the run to disk", () => {
    store.save(makeState({ params: { ssn: "123-45-6789", memberId: "10023" } }));
    const raw = readFileSync(join(dir, "run-1.json"), "utf-8");
    expect(raw).not.toContain("123-45-6789");
    expect(raw).toContain("REDACTED");
    // memberId is on the allowlist -- an ordinary identifier, not a secret --
    // so it stays legible on disk for anyone debugging a stuck run.
    expect(raw).toContain("10023");
  });

  it("clears a run atomically, leaving no half-written file behind", () => {
    store.save(makeState());
    store.clear("run-1");
    const raw = readFileSync(join(dir, "run-1.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ completed: true });
    // Only the final file should exist -- no leftover .tmp-* file from the
    // temp-file-then-rename write.
    expect(readdirSync(dir)).toEqual(["run-1.json"]);
  });
});
