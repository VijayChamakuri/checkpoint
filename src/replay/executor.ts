import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "playwright";
import type { Capability } from "../schema/capability.js";
import { validateParams, type ParamValidationError } from "../schema/validate-params.js";
import { defaultAllowlist } from "../schema/allowlist.js";
import { executeAction } from "../core/execute-action.js";
import { verifyCheckpoint } from "../core/checkpoint.js";
import { PolicyViolationError, LocatorResolutionError } from "../core/errors.js";
import { detectBusinessOutcome, detectAndDismissInterstitial } from "./known-patterns.js";
import type { ActionLog } from "../logging/action-log.js";

/**
 * The richer signal on failure (3.5): a screenshot alongside the structured
 * log for any non-success outcome (except invalid-input, which never
 * touches the UI). Best-effort -- a screenshot failure never masks the
 * real outcome.
 */
async function captureFailureScreenshot(page: Page, evidenceDir: string, runId: string, tag: string): Promise<string | undefined> {
  try {
    mkdirSync(evidenceDir, { recursive: true });
    const path = join(evidenceDir, `${runId}-${tag}.png`);
    await page.screenshot({ path });
    return path;
  } catch {
    return undefined;
  }
}

export type ReplayResult =
  | { outcome: "success"; outputs: Record<string, unknown> }
  | { outcome: "business"; businessOutcome: string; message: string; screenshot?: string }
  | { outcome: "invalid-input"; errors: ParamValidationError[] }
  | { outcome: "hard-failure"; step: number; expected: string; observed: string; screenshot?: string };

const MAX_RECOVERABLE_RETRIES = 2;

export async function replay(
  page: Page,
  capability: Capability,
  params: Record<string, unknown>,
  log: ActionLog,
  runId: string,
  evidenceDir = "evidence",
): Promise<ReplayResult> {
  const inputErrors = validateParams(capability.inputSchema, params);
  if (inputErrors.length > 0) {
    log.write({ runId, phase: "replay", event: "invalid-input", detail: { errors: inputErrors } });
    return { outcome: "invalid-input", errors: inputErrors };
  }

  const allowlist = defaultAllowlist();
  const expectedOrigin = new URL(page.url()).origin;
  const context = { allowlist, params, humanControlled: false, expectedOrigin };

  // Routed through the same gate every other navigation uses -- an artifact
  // whose entryUrl was hand-edited to a blocked route or a different origin
  // is rejected here instead of being loaded unconditionally.
  try {
    await executeAction(page, { action: "navigate", url: capability.target.entryUrl }, context);
  } catch (error) {
    const observed = error instanceof Error ? error.message : String(error);
    log.write({ runId, phase: "replay", event: "step-error", detail: { step: -1, action: "navigate", observed } });
    if (error instanceof PolicyViolationError) {
      return { outcome: "hard-failure", step: -1, expected: "entryUrl within allowlist", observed };
    }
    throw error;
  }

  const outputs: Record<string, unknown> = {};

  for (let i = 0; i < capability.steps.length; i += 1) {
    const step = capability.steps[i];
    if (!step) continue;

    let attempt = 0;
    while (await detectAndDismissInterstitial(page, context)) {
      attempt += 1;
      log.write({ runId, phase: "replay", event: "recoverable-dismissed", detail: { step: i, attempt } });
      if (attempt >= MAX_RECOVERABLE_RETRIES) {
        const screenshot = await captureFailureScreenshot(page, evidenceDir, runId, "hard-failure");
        return { outcome: "hard-failure", step: i, expected: "interstitial dismissible within retry bound", observed: "interstitial persisted", screenshot };
      }
    }

    try {
      const result = await executeAction(page, step, context);
      if (result) outputs[result.field] = result.value;
      log.write({ runId, phase: "replay", event: "step", detail: { step: i, action: step.action } });
    } catch (error) {
      const observed = error instanceof Error ? error.message : String(error);
      log.write({ runId, phase: "replay", event: "step-error", detail: { step: i, action: step.action, observed } });
      const screenshot = await captureFailureScreenshot(page, evidenceDir, runId, "hard-failure");
      if (error instanceof PolicyViolationError) {
        return { outcome: "hard-failure", step: i, expected: `${step.action} within allowlist`, observed, screenshot };
      }
      if (error instanceof LocatorResolutionError) {
        return { outcome: "hard-failure", step: i, expected: `element resolvable for ${step.action}`, observed, screenshot };
      }
      throw error;
    }

    // Checked AFTER the step, not before: the page's starting state (e.g. an
    // empty /search results table) can incidentally match a business-outcome
    // marker before any action has actually run.
    const businessOutcome = await detectBusinessOutcome(page);
    if (businessOutcome) {
      log.write({ runId, phase: "replay", event: "business-outcome", detail: { step: i, ...businessOutcome } });
      const screenshot = await captureFailureScreenshot(page, evidenceDir, runId, "business-outcome");
      return { outcome: "business", businessOutcome: businessOutcome.outcome, message: businessOutcome.message, screenshot };
    }
  }

  const checkpointOk = await verifyCheckpoint(page, capability.checkpoint, params);
  if (!checkpointOk) {
    log.write({ runId, phase: "replay", event: "checkpoint-failed", detail: { checkpoint: capability.checkpoint } });
    const screenshot = await captureFailureScreenshot(page, evidenceDir, runId, "checkpoint-failed");
    return {
      outcome: "hard-failure",
      step: capability.steps.length,
      expected: `checkpoint ${JSON.stringify(capability.checkpoint)}`,
      observed: `current url ${page.url()}`,
      screenshot,
    };
  }

  log.write({ runId, phase: "replay", event: "success", detail: { outputs } });
  return { outcome: "success", outputs };
}
