import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyCheckpoint } from "../../src/core/checkpoint.js";
import { startTestApp, stopTestApp, type TestApp } from "./test-app.js";

describe("verifyCheckpoint", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp(4105);
    await t.loginAndGoto("/member/10023");
  });

  afterAll(async () => {
    await stopTestApp(t);
  });

  it("matches a well-formed, escaped-literal-plus-wildcard pattern", async () => {
    const ok = await verifyCheckpoint(t.page, { type: "url-matches", pattern: "/member/10023" }, {});
    expect(ok).toBe(true);
  });

  it("matches with the wildcard standing in for a parameterized segment", async () => {
    const ok = await verifyCheckpoint(t.page, { type: "url-matches", pattern: "/member/.*" }, {});
    expect(ok).toBe(true);
  });

  it("fails closed on a pattern shaped like a ReDoS payload instead of compiling it", async () => {
    // (a+)+ is the classic catastrophic-backtracking shape. deriveCheckpoint
    // never produces parentheses, so this can only come from a hand-edited
    // or otherwise untrusted artifact -- it must be rejected, not run.
    const ok = await verifyCheckpoint(t.page, { type: "url-matches", pattern: "(a+)+$" }, {});
    expect(ok).toBe(false);
  });

  it("rejects other regex metacharacters outside the escaped-literal/wildcard shape", async () => {
    const ok = await verifyCheckpoint(t.page, { type: "url-matches", pattern: "/member/[0-9]+" }, {});
    expect(ok).toBe(false);
  });
});
