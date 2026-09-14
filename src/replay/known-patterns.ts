import type { Page } from "playwright";
import { executeAction, type ExecuteContext } from "../core/execute-action.js";

/**
 * Small, app-specific registry of known page patterns, matched against the
 * body text. Business outcomes are expected results the caller needs to
 * know about, not crashes; recoverable conditions are dismissed and retried
 * within a bound. Extending to a new target app means adding entries here,
 * not changing the replay executor.
 */

export interface BusinessOutcomeMatch {
  outcome: string;
  message: string;
}

const BUSINESS_OUTCOME_MARKERS: { marker: string; outcome: string }[] = [
  { marker: "No such member.", outcome: "member_not_found" },
  { marker: "No results found for", outcome: "member_not_found" },
  { marker: "Access denied.", outcome: "permission_denied" },
  { marker: "Your session has expired.", outcome: "session_expired" },
  { marker: "enter a positive number", outcome: "validation_error" },
];

export async function detectBusinessOutcome(page: Page): Promise<BusinessOutcomeMatch | null> {
  const bodyText = (await page.textContent("body")) ?? "";
  for (const { marker, outcome } of BUSINESS_OUTCOME_MARKERS) {
    if (bodyText.includes(marker)) {
      return { outcome, message: marker };
    }
  }
  return null;
}

/**
 * Dismissing an interstitial is still a click on the live page, so it goes
 * through the same executeAction() gate as every other action -- routing it
 * around the allowlist would mean any page whose text happens to match the
 * marker gets a button clicked with no policy check at all.
 */
export async function detectAndDismissInterstitial(page: Page, context: ExecuteContext): Promise<boolean> {
  const bodyText = (await page.textContent("body")) ?? "";
  if (!bodyText.includes("Scheduled maintenance notice")) return false;
  const continueButton = page.getByRole("button", { name: "Continue" });
  if ((await continueButton.count()) === 0) return false;

  await executeAction(
    page,
    {
      action: "click",
      locator: {
        role: "button",
        name: "Continue",
        framePath: [],
        structuralPath: ["0"],
        fallbackCoordinate: { x: 0, y: 0 },
      },
    },
    context,
  );
  return true;
}
