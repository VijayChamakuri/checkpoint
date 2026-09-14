import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redactDeep } from "./redact.js";

export interface LogEntry {
  ts: string;
  runId: string;
  phase: "discovery" | "replay" | "escalation";
  event: string;
  detail?: Record<string, unknown>;
}

/**
 * Append-only, flushed-per-step structured log. Uses synchronous appendFileSync
 * deliberately: it flushes to disk immediately on each call, so a crash right
 * after a log line is written never loses that line -- no buffering to lose.
 */
export class ActionLog {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  write(entry: Omit<LogEntry, "ts">): void {
    const full: LogEntry = { ts: new Date().toISOString(), ...entry };
    const redacted = redactDeep(full);
    appendFileSync(this.filePath, `${JSON.stringify(redacted)}\n`, "utf-8");
  }
}
