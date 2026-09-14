import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { escalateAndAwaitResume } from "../../src/escalation/handoff.js";
import { RunStateStore } from "../../src/escalation/run-state.js";
import { ActionLog } from "../../src/logging/action-log.js";
import { startTestApp, stopTestApp, type TestApp } from "./test-app.js";

describe("escalation handoff", () => {
  let t: TestApp;
  let dir: string;

  beforeAll(async () => {
    t = await startTestApp(4104);
  });

  afterAll(async () => {
    await stopTestApp(t);
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("blocks until the resume signal arrives, then reflects the human's changes", async () => {
    dir = mkdtempSync(join(tmpdir(), "handoff-test-"));
    const store = new RunStateStore(dir);
    const log = new ActionLog(join(dir, "log.jsonl"));
    await t.loginAndGoto("/member/10023");

    const state = {
      runId: "handoff-test-1",
      capabilityId: "test-capability",
      phase: "discovery" as const,
      stepIndex: 0,
      control: "agent" as const,
      params: {},
      updatedAt: new Date().toISOString(),
    };

    let resolved = false;
    const handoffPromise = escalateAndAwaitResume(t.page, "test escalation", state, store, log).then((summary) => {
      resolved = true;
      return summary;
    });

    // The promise must not resolve before resume is signalled.
    await new Promise((r) => setTimeout(r, 100));
    expect(resolved).toBe(false);
    expect(store.load("handoff-test-1")?.control).toBe("human");

    // The human navigates the SAME session while it's paused.
    await t.page.goto(`${t.baseUrl}/member/10045`);

    const resumeResponse = await fetch(`http://localhost:${process.env.RESUME_PORT ?? 4102}/resume`, { method: "POST" });
    expect(resumeResponse.status).toBe(200);

    const summary = await handoffPromise;
    expect(summary.urlBefore).toContain("/member/10023");
    expect(summary.urlAfter).toContain("/member/10045");
    expect(summary.humanActedOnSameSession).toBe(true);
    expect(store.load("handoff-test-1")?.control).toBe("agent");
  });

  it("verifies a passed checkpoint against whatever state the human leaves the page in", async () => {
    dir = mkdtempSync(join(tmpdir(), "handoff-test-"));
    const store = new RunStateStore(dir);
    const log = new ActionLog(join(dir, "log.jsonl"));
    await t.loginAndGoto("/member/10023");

    const state = {
      runId: "handoff-test-2",
      capabilityId: "test-capability",
      phase: "discovery" as const,
      stepIndex: 0,
      control: "agent" as const,
      params: {},
      updatedAt: new Date().toISOString(),
    };
    const checkpoint = { type: "url-matches" as const, pattern: "/member/10045" };

    const handoffPromise = escalateAndAwaitResume(t.page, "test escalation", state, store, log, checkpoint);

    await new Promise((r) => setTimeout(r, 100));
    // The human lands the page exactly where the checkpoint expects.
    await t.page.goto(`${t.baseUrl}/member/10045`);
    await fetch(`http://localhost:${process.env.RESUME_PORT ?? 4102}/resume`, { method: "POST" });

    const summary = await handoffPromise;
    expect(summary.checkpointOk).toBe(true);
  });
});
