import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactDeep } from "../logging/redact.js";

export interface RunState {
  runId: string;
  capabilityId: string;
  phase: "discovery" | "replay";
  stepIndex: number;
  control: "agent" | "human";
  params: Record<string, unknown>;
  lastCheckpointOk?: boolean;
  updatedAt: string;
}

/**
 * Atomic temp-file-then-rename snapshot of the current run's state, written
 * at every state transition (especially before ceding control to a human).
 * On restart, an incomplete snapshot means the run can be resumed instead of
 * silently losing it -- see loadIncomplete().
 */
export class RunStateStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private pathFor(runId: string): string {
    return join(this.dir, `${runId}.json`);
  }

  save(state: RunState): void {
    // params can hold whatever the caller passed in for the run (a real SSN
    // typed into a form field, say), and this file sits on disk between
    // steps -- same reason the artifact writer redacts before it writes.
    const redacted: RunState = { ...state, params: redactDeep(state.params) };
    const finalPath = this.pathFor(state.runId);
    const tempPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempPath, JSON.stringify(redacted, null, 2), "utf-8");
    renameSync(tempPath, finalPath);
  }

  load(runId: string): RunState | undefined {
    const path = this.pathFor(runId);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  clear(runId: string): void {
    const path = this.pathFor(runId);
    if (!existsSync(path)) return;
    // Same atomic write as save() -- a crash mid-write here shouldn't be
    // able to leave a half-written run-state file that loadIncomplete()
    // then trips over on the next startup.
    const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempPath, JSON.stringify({ completed: true }, null, 2), "utf-8");
    renameSync(tempPath, path);
  }

  loadIncomplete(): RunState[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => JSON.parse(readFileSync(join(this.dir, f), "utf-8")))
      .filter((s: RunState | { completed: true }): s is RunState => !("completed" in s));
  }
}
