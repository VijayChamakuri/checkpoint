/**
 * Single shared redaction gate, called by both the artifact writer and the
 * JSONL logger before anything touches disk -- same root-cause-not-per-caller
 * principle as executeAction(). Two layers: a field-name denylist, and a
 * generic pattern backstop for sensitive-shaped values in unexpected fields.
 *
 * Known, documented limit: a sensitive value that matches neither the
 * denylist's field names nor the regex backstop's shapes will not be caught.
 * This is a best-effort defense, not a guarantee -- see REPORT.md's Safety
 * section.
 */

const DENYLIST_FIELD_PATTERN = /ssn|account|routing|password|token|credential/i;
// System-generated identifiers, not secrets -- without this, the card-number-shaped
// value pattern below false-positives on runId (a 13-digit Date.now() timestamp,
// structurally indistinguishable from an unformatted card number). Caught by
// actually reading a real evidence log, not by inspection.
const ALLOWLISTED_FIELDS = new Set(["memberId", "runId", "sourceRunId"]);

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN-shaped
  /\b(?:\d[ -]?){13,19}\b/, // card-number-shaped
  /\b(?:sk|pk|sess|bearer)[-_][A-Za-z0-9]{16,}\b/i, // bearer/API-token-shaped
];

export function redactField(fieldName: string, value: unknown): unknown {
  if (ALLOWLISTED_FIELDS.has(fieldName)) return value;
  if (DENYLIST_FIELD_PATTERN.test(fieldName)) {
    return `[REDACTED:${fieldName}]`;
  }
  if (typeof value === "string") {
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        return `[REDACTED:${fieldName}]`;
      }
    }
  }
  return value;
}

/**
 * Redacts only the literal-value fields of a capability artifact --
 * Step.value, Checkpoint.text, and Checkpoint.expectedValue when they are a
 * plain typed string rather than a {paramRef} reference -- and leaves every
 * locator identity field (role, name, structuralPath, framePath, textMatch)
 * untouched. A blanket redactDeep() over the whole artifact would risk
 * corrupting the very fields replay depends on to find the right element;
 * this only touches what could actually be sensitive captured data.
 */
export function redactCapabilityValue(value: unknown, fieldName: string): unknown {
  if (value !== null && typeof value === "object" && "paramRef" in value) return value;
  return redactField(fieldName, value);
}

/** Recursively redacts every field of a plain JSON-like object or array. */
export function redactDeep<T>(value: T, fieldName = "$"): T {
  if (Array.isArray(value)) {
    return value.map((item, i) => redactDeep(item, `${fieldName}[${i}]`)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const redacted = redactField(key, v);
      result[key] = typeof redacted === "object" && redacted !== null ? redactDeep(redacted, key) : redacted;
    }
    return result as unknown as T;
  }
  return redactField(fieldName, value) as T;
}
