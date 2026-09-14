import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { replay } from "../../src/replay/executor.js";
import { ActionLog } from "../../src/logging/action-log.js";
import type { Capability } from "../../src/schema/capability.js";
import { startTestApp, stopTestApp, type TestApp } from "./test-app.js";

function lookupBalanceCapability(): Capability {
  return {
    id: "lookup-member-balance",
    version: 1,
    name: "lookup-member-balance",
    description: "Search for a member by ID and read their savings balance.",
    target: { app: "Member Services Console", entryUrl: "/search" },
    inputSchema: { type: "object", properties: { memberId: { type: "string" } }, required: ["memberId"] },
    outputSchema: { type: "object", properties: { savingsBalance: { type: "string" } }, required: [] },
    steps: [
      {
        action: "type",
        locator: { role: "textbox", name: "Member name or ID", framePath: [], structuralPath: [], fallbackCoordinate: { x: 0, y: 0 } },
        value: { paramRef: "memberId" },
      },
      {
        action: "click",
        locator: { role: "button", name: "Search", framePath: [], structuralPath: [], fallbackCoordinate: { x: 0, y: 0 } },
      },
      {
        action: "click",
        locator: {
          role: "link",
          name: "View",
          framePath: [],
          structuralPath: [],
          textMatch: { paramRef: "memberId" },
          fallbackCoordinate: { x: 0, y: 0 },
        },
      },
      {
        action: "read",
        locator: {
          role: "cell",
          name: "",
          framePath: [],
          structuralPath: ["1"],
          textMatch: "Savings Balance",
          fallbackCoordinate: { x: 0, y: 0 },
        },
        extract: { field: "savingsBalance", from: "text" },
      },
    ],
    checkpoint: { type: "url-matches", pattern: "/member/.*" },
    createdAt: new Date().toISOString(),
    sourceRunId: "discover-test",
  };
}

describe("replay executor", () => {
  let t: TestApp;
  let logDir: string;

  beforeAll(async () => {
    t = await startTestApp(4103);
  });

  afterAll(async () => {
    await stopTestApp(t);
  });

  afterEach(() => {
    if (logDir) rmSync(logDir, { recursive: true, force: true });
  });

  function makeLog() {
    logDir = mkdtempSync(join(tmpdir(), "replay-log-"));
    return new ActionLog(join(logDir, "log.jsonl"));
  }

  it("replays deterministically and returns typed outputs on the happy path", async () => {
    await t.loginAndGoto("/search");
    const log = makeLog();
    const result = await replay(t.page, lookupBalanceCapability(), { memberId: "10045" }, log, "test-run-1", logDir);
    expect(result).toEqual({ outcome: "success", outputs: { savingsBalance: "$812.10" } });
  });

  it("replays the SAME capability with a different member and gets a different result", async () => {
    await t.loginAndGoto("/search");
    const log = makeLog();
    const result = await replay(t.page, lookupBalanceCapability(), { memberId: "10023" }, log, "test-run-2", logDir);
    expect(result).toEqual({ outcome: "success", outputs: { savingsBalance: "$4210.55" } });
  });

  it("classifies a not-found member as a business outcome, not a crash", async () => {
    await t.loginAndGoto("/search");
    const log = makeLog();
    const result = await replay(t.page, lookupBalanceCapability(), { memberId: "99999" }, log, "test-run-3", logDir);
    expect(result.outcome).toBe("business");
    if (result.outcome === "business") {
      expect(result.businessOutcome).toBe("member_not_found");
    }
  });

  it("rejects malformed input before touching the UI", async () => {
    await t.loginAndGoto("/search");
    const log = makeLog();
    const result = await replay(t.page, lookupBalanceCapability(), {}, log, "test-run-4", logDir);
    expect(result.outcome).toBe("invalid-input");
  });

  it("writes a structured, redacted JSONL log for the run", async () => {
    await t.loginAndGoto("/search");
    const log = makeLog();
    await replay(t.page, lookupBalanceCapability(), { memberId: "10045" }, log, "test-run-5", logDir);
    const lines = readFileSync(join(logDir, "log.jsonl"), "utf-8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    const entries = lines.map((l) => JSON.parse(l));
    expect(entries.some((e) => e.event === "success")).toBe(true);
  });
});
