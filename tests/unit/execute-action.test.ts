import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeAction } from "../../src/core/execute-action.js";
import { defaultAllowlist } from "../../src/schema/allowlist.js";
import { PolicyViolationError, LocatorResolutionError } from "../../src/core/errors.js";
import { startTestApp, stopTestApp, type TestApp } from "./test-app.js";

describe("executeAction", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp(4101);
  });

  afterAll(async () => {
    await stopTestApp(t);
  });

  it("allows a click on an allowed route", async () => {
    await t.loginAndGoto("/search");
    await executeAction(t.page, { action: "type", locator: makeLocator("textbox", "Member name or ID"), value: "a" });
    await executeAction(t.page, { action: "click", locator: makeLocator("button", "Search") });
    expect(t.page.url()).toContain("/search");
  });

  it("disambiguates multiple 'View' links by the row containing the member's ID", async () => {
    await t.loginAndGoto("/search");
    await executeAction(t.page, { action: "type", locator: makeLocator("textbox", "Member name or ID"), value: "a" });
    await executeAction(t.page, { action: "click", locator: makeLocator("button", "Search") });

    const viewLocator = {
      role: "link",
      name: "View",
      framePath: [],
      structuralPath: [],
      textMatch: { paramRef: "memberId" },
      fallbackCoordinate: { x: 0, y: 0 },
    };
    await executeAction(t.page, { action: "click", locator: viewLocator }, testContext({ memberId: "10045" }));
    expect(t.page.url()).toContain("/member/10045");
  });

  it("reads the savings balance by its stable label, not its (unknowable) value", async () => {
    await t.loginAndGoto("/member/10023");
    const result = await executeAction(t.page, {
      action: "read",
      locator: {
        role: "cell",
        name: "", // wildcard: the value differs per member and can't be the match key
        framePath: [],
        structuralPath: ["1"], // the cell after the "Savings Balance" label cell
        textMatch: "Savings Balance",
        fallbackCoordinate: { x: 0, y: 0 },
      },
      extract: { field: "savingsBalance", from: "text" },
    });
    expect(result?.value).toBe("$4210.55");
  });

  it("blocks the final sub-account create action outright", async () => {
    await t.loginAndGoto("/member/20099/subaccount/new");
    await executeAction(t.page, { action: "type", locator: makeLocator("textbox", "Initial deposit ($)"), value: "100" });
    await executeAction(t.page, { action: "click", locator: makeLocator("button", "Continue") });
    expect(t.page.url()).toContain("/subaccount/confirm");

    await expect(
      executeAction(t.page, { action: "click", locator: makeLocator("button", "Confirm & Create") }),
    ).rejects.toThrow(PolicyViolationError);
  });

  it("throws LocatorResolutionError when no element matches", async () => {
    await t.loginAndGoto("/search");
    await expect(
      executeAction(t.page, { action: "click", locator: makeLocator("button", "Definitely Not A Real Button") }),
    ).rejects.toThrow(LocatorResolutionError);
  });

  it("rejects navigation to a route outside the allowlist", async () => {
    await t.loginAndGoto("/search");
    await expect(
      executeAction(t.page, { action: "navigate", url: `${t.baseUrl}/__test__/reset` }),
    ).rejects.toThrow(PolicyViolationError);
  });
});

function makeLocator(role: string, name: string) {
  return {
    role,
    name,
    framePath: [],
    structuralPath: [],
    fallbackCoordinate: { x: 0, y: 0 },
  };
}

function testContext(params: Record<string, unknown> = {}) {
  return { allowlist: defaultAllowlist(), params, humanControlled: false };
}
