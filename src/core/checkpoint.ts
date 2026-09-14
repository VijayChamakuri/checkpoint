import type { Page } from "playwright";
import type { Checkpoint } from "../schema/capability.js";
import { resolveParam } from "../schema/param-binding.js";
import { resolveLocator } from "./resolve-locator.js";

/**
 * checkpoint.pattern comes from a saved artifact -- something that can be
 * hand-edited or come from an untrusted source, not just from our own
 * deriveCheckpoint(). Compiling an arbitrary string as a regex risks ReDoS:
 * a pattern with nested quantifiers like "(a+)+$" can take exponential time
 * on the wrong input. deriveCheckpoint only ever emits escaped literal
 * characters separated by the literal wildcard ".*", so this checks the
 * pattern has exactly that shape -- no parentheses (no grouping, so no
 * nested quantifiers are even expressible) and no other unescaped
 * metacharacter -- before it's ever handed to RegExp.
 */
const SAFE_URL_PATTERN = /^(?:\\[.*+?^${}()|[\]\\]|\.\*|[^.*+?^${}()|[\]\\])*$/;

function compileSafeUrlPattern(pattern: string): RegExp | null {
  if (!SAFE_URL_PATTERN.test(pattern)) return null;
  return new RegExp(`^${pattern}$`);
}

/**
 * Shared checkpoint verification -- used by the replay executor AND, after
 * an escalation handoff resumes, invoked again on whatever state the human
 * left the page in. It does not care who produced the current state, only
 * whether the declared condition is now true: one code path, not a special
 * "trust the human" branch.
 */
export async function verifyCheckpoint(
  page: Page,
  checkpoint: Checkpoint,
  params: Record<string, unknown>,
): Promise<boolean> {
  if (checkpoint.type === "url-matches") {
    const pattern = compileSafeUrlPattern(checkpoint.pattern);
    // A pattern that doesn't match the expected escaped-literal-plus-wildcard
    // shape is treated as failing verification rather than compiled anyway --
    // fail closed on a malformed or tampered-with artifact, not open.
    if (!pattern) return false;
    return pattern.test(new URL(page.url()).pathname);
  }
  if (checkpoint.type === "text-present") {
    const text = resolveParam(checkpoint.text, params);
    const bodyText = await page.textContent("body");
    return (bodyText ?? "").includes(text);
  }
  if (checkpoint.type === "element-visible") {
    try {
      const el = await resolveLocator(page, checkpoint.locator, params);
      return await el.isVisible();
    } catch {
      return false;
    }
  }
  // field-equals
  try {
    const el = await resolveLocator(page, checkpoint.locator, params);
    const actual =
      checkpoint.from === "attribute"
        ? ((await el.getAttribute(checkpoint.attribute ?? "value")) ?? "")
        : ((await el.textContent()) ?? "").trim();
    const expected = resolveParam(checkpoint.expectedValue, params);
    return actual === expected;
  } catch {
    return false;
  }
}
