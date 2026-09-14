import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { Checkpoint, Step } from "../schema/capability.js";
import { defaultAllowlist } from "../schema/allowlist.js";
import { executeAction } from "../core/execute-action.js";
import { PolicyViolationError, LocatorResolutionError } from "../core/errors.js";
import type { ActionLog } from "../logging/action-log.js";
import { capturePerception, type Perception } from "./perception.js";
import { recordStep, recordNavigateStep } from "./record-step.js";
import { callModel, createClient, MODEL, LLMCallFailure } from "./llm-client.js";
import { discoveryTools, systemPrompt } from "./tools.js";

export interface DiscoveryOptions {
  goal: string;
  targetApp: string;
  params: Record<string, unknown>;
  maxSteps?: number;
  timeoutMs?: number;
  runId: string;
  log: ActionLog;
  /**
   * Steps already recorded before this call, carried over from an earlier
   * attempt that escalated to a human and was resumed. Without this, a run
   * that escalates partway through would silently lose everything it
   * recorded before the handoff.
   */
  initialSteps?: Step[];
}

export interface DiscoveryResult {
  outcome: "success" | "escalated";
  steps: Step[];
  outputs?: Record<string, unknown>;
  checkpoint?: Checkpoint;
  escalationReason?: string;
}

const NO_CHANGE_STREAK_LIMIT = 3;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function runDiscovery(page: Page, opts: DiscoveryOptions): Promise<DiscoveryResult> {
  const maxSteps = opts.maxSteps ?? 12;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const allowlist = defaultAllowlist();
  const expectedOrigin = new URL(page.url()).origin;
  const client = createClient();
  const steps: Step[] = opts.initialSteps ?? [];

  const messages: Anthropic.MessageParam[] = [];
  const extractedOutputs: Record<string, unknown> = {};
  let noChangeStreak = 0;
  let lastUrl = page.url();

  const perception = await capturePerception(page);
  messages.push({ role: "user", content: [{ type: "text", text: perceptionText(perception) }] });

  if (perception.injectionFlagged) {
    opts.log.write({ runId: opts.runId, phase: "discovery", event: "injection-flagged", detail: { reason: perception.injectionReason } });
    return { outcome: "escalated", steps, escalationReason: `prompt-injection tripwire: ${perception.injectionReason}` };
  }

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    if (Date.now() >= deadline) {
      opts.log.write({ runId: opts.runId, phase: "discovery", event: "timeout", detail: { timeoutMs, stepIndex } });
      return { outcome: "escalated", steps, escalationReason: `discovery timed out after ${timeoutMs}ms` };
    }

    let response: Anthropic.Message;
    try {
      response = await callModel(client, {
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt(opts.goal, opts.targetApp),
        tools: discoveryTools,
        messages,
      });
    } catch (error) {
      if (error instanceof LLMCallFailure) {
        opts.log.write({ runId: opts.runId, phase: "discovery", event: "llm-call-failure", detail: { kind: error.kind, message: error.message } });
        return { outcome: "escalated", steps, escalationReason: `LLMCallFailure: ${error.message}` };
      }
      throw error;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    const reasoning = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join(" ");

    if (!toolUse) {
      opts.log.write({ runId: opts.runId, phase: "discovery", event: "no-tool-call", detail: { stopReason: response.stop_reason } });
      noChangeStreak += 1;
      messages.push({
        role: "user",
        content: [{ type: "text", text: "You must call one of the provided tools to proceed." }],
      });
      if (noChangeStreak >= NO_CHANGE_STREAK_LIMIT) {
        return { outcome: "escalated", steps, escalationReason: "model produced no tool calls for 3 consecutive turns" };
      }
      continue;
    }

    if (toolUse.name === "request_human") {
      const reason = (toolUse.input as { reason: string }).reason;
      opts.log.write({ runId: opts.runId, phase: "discovery", event: "request-human", detail: { reason } });
      return { outcome: "escalated", steps, escalationReason: `model requested human help: ${reason}` };
    }

    if (toolUse.name === "finish") {
      const checkpoint = deriveCheckpoint(page.url(), opts.params);
      opts.log.write({ runId: opts.runId, phase: "discovery", event: "finish", detail: { outputs: extractedOutputs } });
      return { outcome: "success", steps, outputs: extractedOutputs, checkpoint };
    }

    let toolResultText: string;
    try {
      toolResultText = await executeTool(page, toolUse, opts, steps, extractedOutputs, expectedOrigin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      opts.log.write({ runId: opts.runId, phase: "discovery", event: "action-error", detail: { tool: toolUse.name, message } });
      if (error instanceof PolicyViolationError) {
        return { outcome: "escalated", steps, escalationReason: `policy violation: ${message}` };
      }
      if (error instanceof LocatorResolutionError) {
        return { outcome: "escalated", steps, escalationReason: `locator resolution failed: ${message}` };
      }
      throw error;
    }

    const currentUrl = page.url();
    if (currentUrl === lastUrl && toolUse.name !== "read_state" && toolUse.name !== "extract") {
      noChangeStreak += 1;
    } else {
      noChangeStreak = 0;
    }
    lastUrl = currentUrl;
    if (noChangeStreak >= NO_CHANGE_STREAK_LIMIT) {
      return { outcome: "escalated", steps, escalationReason: `no page-state change for ${NO_CHANGE_STREAK_LIMIT} consecutive actions` };
    }

    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUse.id, content: toolResultText }],
    });
    opts.log.write({ runId: opts.runId, phase: "discovery", event: "step", detail: { tool: toolUse.name, input: toolUse.input, url: currentUrl, reasoning: reasoning || undefined } });
  }

  return { outcome: "escalated", steps, escalationReason: `max steps (${maxSteps}) reached without finish` };
}

async function executeTool(
  page: Page,
  toolUse: Anthropic.ToolUseBlock,
  opts: DiscoveryOptions,
  steps: Step[],
  extractedOutputs: Record<string, unknown>,
  expectedOrigin: string,
): Promise<string> {
  const allowlist = defaultAllowlist();
  const context = { allowlist, params: opts.params, humanControlled: false, expectedOrigin };

  if (toolUse.name === "extract") {
    const { ref, field } = toolUse.input as { ref: string; field: string };
    const step = await recordStep(page, "read", ref, opts.params, { extractField: field });
    const result = await executeAction(page, step, context);
    steps.push(step);
    if (result) extractedOutputs[field] = result.value;
    return `extracted ${field} = ${result?.value ?? "(no value)"}`;
  }
  if (toolUse.name === "click") {
    const { ref } = toolUse.input as { ref: string };
    const step = await recordStep(page, "click", ref, opts.params);
    await executeAction(page, step, context);
    steps.push(step);
    return "clicked";
  }
  if (toolUse.name === "type") {
    const { ref, text } = toolUse.input as { ref: string; text: string };
    const step = await recordStep(page, "type", ref, opts.params, { value: text });
    await executeAction(page, step, context);
    steps.push(step);
    return "typed";
  }
  if (toolUse.name === "navigate") {
    const { url } = toolUse.input as { url: string };
    const step = recordNavigateStep(url, opts.params);
    await executeAction(page, step, context);
    steps.push(step);
    const perception = await capturePerception(page);
    return perceptionText(perception);
  }
  if (toolUse.name === "read_state") {
    const perception = await capturePerception(page);
    if (perception.injectionFlagged) {
      throw new PolicyViolationError(`prompt-injection tripwire: ${perception.injectionReason}`, page.url(), "read");
    }
    return perceptionText(perception);
  }
  throw new Error(`unknown tool ${toolUse.name}`);
}

function perceptionText(perception: Perception): string {
  const lines = perception.nodes.map((n) => `[${n.ref}] ${n.role} "${n.name}"`);
  return `URL: ${perception.url}\n${lines.join("\n")}`;
}

/**
 * Deterministic checkpoint derivation: the final route, with any input
 * parameter's concrete value genericized back into a wildcard, so replay
 * with a DIFFERENT parameter value still satisfies the same checkpoint
 * shape rather than only matching the originally-recorded route.
 */
function deriveCheckpoint(finalUrl: string, params: Record<string, unknown>): Checkpoint {
  const WILDCARD = "WILDCARDTOKEN";
  let pathname = new URL(finalUrl).pathname;
  for (const value of Object.values(params)) {
    // An empty string is not a wildcard to substitute -- "".split(x) splits
    // a string into every individual character, which would shred the
    // pathname into a near-meaningless pattern that matches almost anything.
    const literal = String(value);
    if (literal.length === 0) continue;
    pathname = pathname.split(literal).join(WILDCARD);
  }
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.split(WILDCARD).join(".*");
  return { type: "url-matches", pattern };
}
