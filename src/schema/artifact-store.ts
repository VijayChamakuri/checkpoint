import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capabilitySchema, type Capability, type Step } from "./capability.js";
import { redactCapabilityValue } from "../logging/redact.js";

/**
 * Redacts the literal-value fields of a capability -- Step.value and the
 * checkpoint's literal text/expectedValue -- before it's ever written to
 * disk. Locator identity fields are never touched: redacting a role or
 * accessible name would break the very targeting replay depends on.
 */
/** Only characters that are safe as a single path segment on every platform. */
function sanitizeId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`invalid capability id "${id}": only letters, digits, "-", and "_" are allowed`);
  }
  return id;
}

function redactCapability(capability: Capability): Capability {
  const steps: Step[] = capability.steps.map((step) =>
    step.action === "type" ? { ...step, value: redactCapabilityValue(step.value, "value") as typeof step.value } : step,
  );
  const checkpoint = capability.checkpoint;
  const redactedCheckpoint =
    checkpoint.type === "text-present"
      ? { ...checkpoint, text: redactCapabilityValue(checkpoint.text, "text") as typeof checkpoint.text }
      : checkpoint.type === "field-equals"
        ? { ...checkpoint, expectedValue: redactCapabilityValue(checkpoint.expectedValue, "expectedValue") as typeof checkpoint.expectedValue }
        : checkpoint;
  return { ...capability, steps, checkpoint: redactedCheckpoint };
}

/**
 * Versioned JSON files on disk, one immutable file per version. Atomic
 * write via temp-file-then-rename so a crash mid-write never corrupts an
 * artifact -- rename is atomic on POSIX filesystems, an in-progress write
 * to a temp path is simply discarded on crash rather than half-overwriting
 * the real file.
 */
export class ArtifactStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private pathFor(id: string, version: number): string {
    // capability.id is caller-controlled (the --name CLI flag, or a loaded
    // artifact's own id) and validated only as a non-empty string -- without
    // this, an id like "../../../etc/passwd" would let save()/load() write
    // or read outside this store's directory entirely.
    const safeId = sanitizeId(id);
    return join(this.dir, `${safeId}.v${version}.json`);
  }

  nextVersion(id: string): number {
    let version = 1;
    while (existsSync(this.pathFor(id, version))) version += 1;
    return version;
  }

  save(capability: Capability): string {
    capabilitySchema.parse(capability); // throws if the artifact is malformed -- no partial write follows
    const redacted = redactCapability(capability);
    const finalPath = this.pathFor(capability.id, capability.version);
    const tempPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempPath, JSON.stringify(redacted, null, 2), "utf-8");
    renameSync(tempPath, finalPath);
    return finalPath;
  }

  load(id: string, version?: number): Capability {
    const resolvedVersion = version ?? this.latestVersion(id);
    const path = this.pathFor(id, resolvedVersion);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return capabilitySchema.parse(raw);
  }

  loadFromPath(path: string): Capability {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return capabilitySchema.parse(raw);
  }

  private latestVersion(id: string): number {
    const next = this.nextVersion(id);
    if (next === 1) throw new Error(`no saved capability found for id "${id}"`);
    return next - 1;
  }
}
