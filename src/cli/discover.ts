import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { runDiscovery } from "../agent/discovery-loop.js";
import { establishSession } from "../core/session.js";
import { ArtifactStore } from "../schema/artifact-store.js";
import type { Capability, ObjectSchema } from "../schema/capability.js";
import { ActionLog } from "../logging/action-log.js";
import { RunStateStore } from "../escalation/run-state.js";
import { escalateAndAwaitResume } from "../escalation/handoff.js";
import { verifyCheckpoint } from "../core/checkpoint.js";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i];
    if (entry?.startsWith("--")) {
      const key = entry.slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? next : "true";
      if (next && !next.startsWith("--")) i += 1;
    }
  }
  return args;
}

function inferObjectSchema(values: Record<string, unknown>): ObjectSchema {
  const properties: ObjectSchema["properties"] = {};
  for (const [key, value] of Object.entries(values)) {
    const type = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
    properties[key] = { type };
  }
  return { type: "object", properties, required: Object.keys(values) };
}

function loadEnvFile(): void {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
}

/**
 * A bare Number(...) turns a malformed flag into NaN, which then makes
 * every comparison against it silently do the wrong thing instead of
 * raising an error -- a stopping condition that looks configurable but
 * quietly stops working the moment the value doesn't parse.
 */
function parsePositiveInt(raw: string | undefined, flagName: string, fallback?: number): number {
  if (raw === undefined) {
    if (fallback === undefined) throw new Error(`${flagName} is required`);
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive number, got "${raw}"`);
  }
  return parsed;
}

async function main(): Promise<void> {
  loadEnvFile();
  const args = parseArgs();
  const name = args.name ?? "unnamed-capability";
  const goalTemplate = args.goal;
  const description = args.description ?? goalTemplate ?? "";
  const entryUrl = args["entry-url"] ?? "/search";
  const targetApp = args.app ?? "Member Services Console";
  const baseUrl = args["base-url"] ?? `http://localhost:${process.env.MOCK_APP_PORT ?? 4100}`;
  const maxSteps = parsePositiveInt(args["max-steps"], "--max-steps", 12);
  const timeoutMs = args["timeout-ms"] !== undefined ? parsePositiveInt(args["timeout-ms"], "--timeout-ms") : undefined;
  const params: Record<string, unknown> = args.params ? JSON.parse(args.params) : {};

  if (!goalTemplate) {
    console.error("Usage: npm run discover -- --name <id> --goal \"look up member {{memberId}}\" --params '{\"memberId\":\"10023\"}'");
    process.exit(1);
  }

  const runId = `discover-${Date.now()}`;
  const log = new ActionLog(`evidence/${runId}.jsonl`);
  const runStateStore = new RunStateStore("run-state");

  const filledGoal = fillTemplate(goalTemplate, params);
  console.log(`Starting discovery run ${runId}`);
  console.log(`Goal: ${filledGoal}`);

  const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" });
  const context = await browser.newContext();
  const page = await context.newPage();

  await establishSession(page, baseUrl);
  await page.goto(new URL(entryUrl, baseUrl).toString());

  runStateStore.save({ runId, capabilityId: name, phase: "discovery", stepIndex: 0, control: "agent", params, updatedAt: new Date().toISOString() });

  let result = await runDiscovery(page, { goal: filledGoal, targetApp, params, maxSteps, timeoutMs, runId, log });

  while (result.outcome === "escalated") {
    console.log(`Discovery escalated: ${result.escalationReason}`);
    const state = runStateStore.load(runId) ?? { runId, capabilityId: name, phase: "discovery" as const, stepIndex: result.steps.length, control: "agent" as const, params, updatedAt: new Date().toISOString() };
    await escalateAndAwaitResume(page, result.escalationReason ?? "unknown", state, runStateStore, log);
    console.log("Resuming discovery after human handoff...");
    // Carry over what was already recorded before the escalation -- without
    // this, everything the agent did before getting stuck would be silently
    // dropped from the saved artifact the moment a handoff happens.
    result = await runDiscovery(page, { goal: filledGoal, targetApp, params, maxSteps, timeoutMs, runId, log, initialSteps: result.steps });
    // A single re-attempt after handoff is enough for this deliverable's scope;
    // if it escalates again, the loop above will hand off again (bounded by
    // the human choosing to keep retrying).
  }

  if (result.outcome !== "success" || !result.checkpoint) {
    console.error("Discovery did not complete successfully.");
    await browser.close();
    process.exit(1);
  }

  const store = new ArtifactStore("artifacts");
  const version = store.nextVersion(name);
  const capability: Capability = {
    id: name,
    version,
    name,
    description,
    target: { app: targetApp, entryUrl },
    inputSchema: inferObjectSchema(params),
    outputSchema: inferObjectSchema(result.outputs ?? {}),
    steps: result.steps,
    checkpoint: result.checkpoint,
    createdAt: new Date().toISOString(),
    sourceRunId: runId,
  };

  const checkpointOk = await verifyCheckpoint(page, capability.checkpoint, params);
  if (!checkpointOk) {
    // The tool's own verification just found the derived checkpoint doesn't
    // hold. Saving anyway and reporting success would mean a broken
    // capability gets persisted and treated as a working one -- exactly the
    // kind of silent corruption this whole system is meant to catch, not
    // produce.
    console.error("Discovery finished, but the derived checkpoint does not verify against the final page state. Not saving.");
    await browser.close();
    process.exit(1);
  }

  const savedPath = store.save(capability);
  runStateStore.clear(runId);
  console.log(`Saved capability artifact: ${savedPath}`);
  console.log(`Outputs: ${JSON.stringify(result.outputs, null, 2)}`);

  await browser.close();
}

function fillTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
