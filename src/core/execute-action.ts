import type { Page } from "playwright";
import type { Step } from "../schema/capability.js";
import { resolveParam } from "../schema/param-binding.js";
import { defaultAllowlist, findRiskyRule, isRouteAllowed, type Allowlist } from "../schema/allowlist.js";
import { resolveLocator } from "./resolve-locator.js";
import { PolicyViolationError } from "./errors.js";

export interface ExecuteContext {
  allowlist: Allowlist;
  params: Record<string, unknown>;
  /**
   * True only while a human is physically driving the headed browser during
   * an escalation handoff. In this system's current design the human acts
   * directly on the browser window and never calls back into this function,
   * so no caller sets this true today -- require-confirmation is
   * effectively equivalent to block until a flow exists where our own code
   * performs an action on a human's explicit, already-authorized behalf.
   * Kept as a real (not hardcoded) signal so that flow can be added later
   * without changing this gate.
   */
  humanControlled: boolean;
  /**
   * The origin (scheme + host) the target application is expected to run
   * on. Route-based allowlist checks only ever look at a URL's path, which
   * says nothing about which host that path is on -- a page whose text
   * steers navigation to a different host would otherwise pass an allowlist
   * entry like "/search" purely because the path matches. When set, every
   * navigate is also required to stay on this origin, checked before the
   * path-based allowlist rule runs. Optional only so tests that don't care
   * about origin can omit it; production callers always pass it.
   */
  expectedOrigin?: string;
}

export interface ReadResult {
  field: string;
  value: string;
}

/**
 * The single shared gate for every UI action, called identically by the
 * discovery loop and the replay executor. Enforces the allowlist before
 * dispatching to Playwright -- this is the root-cause enforcement point,
 * not duplicated per caller.
 */
export async function executeAction(
  page: Page,
  step: Step,
  context: ExecuteContext = { allowlist: defaultAllowlist(), params: {}, humanControlled: false },
): Promise<ReadResult | undefined> {
  const currentRoute = new URL(page.url()).pathname;

  if (step.action === "navigate") {
    const url = resolveParam(step.url, context.params);
    // Resolved to an absolute URL before use: Playwright's page.goto() does
    // not resolve a relative path against the page's current URL on its
    // own, so a relative navigate target (the common case -- artifacts
    // record app-relative routes, not full URLs) would otherwise fail.
    const target = new URL(url, page.url());
    checkOrigin(context, target);
    checkPolicy(context, target.pathname, "navigate");
    await page.goto(target.toString());
    return undefined;
  }

  const locator = await resolveLocator(page, step.locator, context.params);

  if (step.action === "click") {
    const effectiveRoute = await resolveClickDestinationRoute(locator, page, currentRoute);
    checkPolicy(context, effectiveRoute, "click");
    await locator.click();
    return undefined;
  }

  if (step.action === "type") {
    checkPolicy(context, currentRoute, "type");
    const value = resolveParam(step.value, context.params);
    await locator.fill(value);
    return undefined;
  }

  if (step.action === "waitFor") {
    checkPolicy(context, currentRoute, "waitFor");
    await locator.waitFor({ state: "visible", timeout: step.timeoutMs ?? 5000 });
    return undefined;
  }

  // step.action === "read"
  checkPolicy(context, currentRoute, "read");
  const value =
    step.extract.from === "attribute"
      ? ((await locator.getAttribute(step.extract.attribute ?? "value")) ?? "")
      : ((await locator.textContent()) ?? "").trim();
  return { field: step.extract.field, value };
}

/**
 * A click can mutate state two different ways: a real <a href> navigation,
 * or a form submit. Both need the allowlist checked against where the click
 * actually leads, not just the page the click happens on -- otherwise a
 * click that looks harmless on its source page can land on a route the
 * allowlist would have blocked.
 */
async function resolveClickDestinationRoute(
  locator: Awaited<ReturnType<typeof resolveLocator>>,
  page: Page,
  currentRoute: string,
): Promise<string> {
  const destination = await locator.evaluate((el) => {
    const anchor = el.closest("a[href]") as HTMLAnchorElement | null;
    if (anchor) return anchor.getAttribute("href");
    const form = el.closest("form");
    return form?.getAttribute("action") ?? null;
  });
  return destination ? new URL(destination, page.url()).pathname : currentRoute;
}

function checkOrigin(context: ExecuteContext, target: URL): void {
  if (context.expectedOrigin && target.origin !== context.expectedOrigin) {
    throw new PolicyViolationError(
      `navigate target origin "${target.origin}" does not match the expected application origin "${context.expectedOrigin}"`,
      target.pathname,
      "navigate",
    );
  }
}

function checkPolicy(context: ExecuteContext, route: string, action: Step["action"]): void {
  if (!isRouteAllowed(context.allowlist, route, action)) {
    throw new PolicyViolationError(`route "${route}" action "${action}" is not on the allowlist`, route, action);
  }
  const risky = findRiskyRule(context.allowlist, route, action);
  if (risky) {
    if (risky.policy === "block") {
      throw new PolicyViolationError(`route "${route}" action "${action}" is a blocked (irreversible) action`, route, action);
    }
    if (risky.policy === "require-confirmation" && !context.humanControlled) {
      throw new PolicyViolationError(
        `route "${route}" action "${action}" requires human confirmation, but no human is in control`,
        route,
        action,
      );
    }
  }
}
