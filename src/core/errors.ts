/** Thrown by executeAction() when an action is outside the allowlist, or a risky action's policy denies it. */
export class PolicyViolationError extends Error {
  constructor(
    message: string,
    public readonly route: string,
    public readonly actionType: string,
  ) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

/** Thrown when the locator disambiguation chain (textMatch -> structuralPath -> fallbackCoordinate) never resolves to exactly one element. */
export class LocatorResolutionError extends Error {
  constructor(
    message: string,
    public readonly candidateCount: number,
  ) {
    super(message);
    this.name = "LocatorResolutionError";
  }
}

/** Thrown when a checkpoint condition is asserted but never becomes true. */
export class CheckpointNotReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckpointNotReachedError";
  }
}
