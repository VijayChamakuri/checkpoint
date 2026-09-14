import { isParamRef, type ParamRef } from "./capability.js";

/**
 * Bidirectional parameter substitution -- the mechanism that makes "replay
 * with different input parameters" actually work, connecting inputSchema to
 * recorded step values instead of leaving them as hardcoded literals.
 */

/** Discovery-time goal templating: "look up member {{memberId}}" -> "look up member 12345". */
export function fillGoalTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    if (!(name in params)) return match;
    return String(params[name]);
  });
}

/**
 * Writer-time binding: if a typed/matched literal exactly equals a supplied
 * parameter's value, store a reference instead of the literal so replay with
 * a DIFFERENT value actually changes what gets typed/matched.
 */
export function bindParamIfMatches(
  literal: string,
  params: Record<string, unknown>,
): string | ParamRef {
  for (const [name, value] of Object.entries(params)) {
    if (String(value) === literal) {
      return { paramRef: name };
    }
  }
  return literal;
}

/** Replay-time resolution: the inverse of bindParamIfMatches. */
export function resolveParam(
  value: string | ParamRef,
  params: Record<string, unknown>,
): string {
  if (!isParamRef(value)) return value;
  const resolved = params[value.paramRef];
  if (resolved === undefined) {
    throw new Error(`paramRef "${value.paramRef}" has no matching input parameter at replay time`);
  }
  return String(resolved);
}
