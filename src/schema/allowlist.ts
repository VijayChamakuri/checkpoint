import { z } from "zod";

export const actionTypeSchema = z.enum(["click", "type", "navigate", "waitFor", "read"]);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const riskyActionRuleSchema = z.object({
  route: z.string(),
  action: actionTypeSchema,
  policy: z.enum(["block", "require-confirmation"]),
});
export type RiskyActionRule = z.infer<typeof riskyActionRuleSchema>;

export const allowlistSchema = z.object({
  allowedRoutes: z.array(z.string()),
  allowedActions: z.array(actionTypeSchema),
  riskyActions: z.array(riskyActionRuleSchema),
});
export type Allowlist = z.infer<typeof allowlistSchema>;

/** "/member/*" -> matches "/member/10023", "/member/10023/subaccount/new", etc. */
export function routeMatches(pattern: string, route: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(route);
}

export function isRouteAllowed(allowlist: Allowlist, route: string, action: ActionType): boolean {
  const routeOk = allowlist.allowedRoutes.some((p) => routeMatches(p, route));
  const actionOk = allowlist.allowedActions.includes(action);
  return routeOk && actionOk;
}

export function findRiskyRule(
  allowlist: Allowlist,
  route: string,
  action: ActionType,
): RiskyActionRule | undefined {
  return allowlist.riskyActions.find((r) => routeMatches(r.route, route) && r.action === action);
}

/**
 * The mock app's allowlist for this deliverable: read-only navigation/search
 * plus reaching (but never submitting) the sub-account confirmation screen.
 * Reaching /subaccount/confirm is a plain allowed route: the goal is to
 * reach the confirmation screen, not submit it. The final create action is
 * blocked outright: irreversible financial mutation is handled conservatively.
 */
export function defaultAllowlist(): Allowlist {
  return {
    allowedRoutes: ["/login", "/search", "/member/*", "/subaccount-terms"],
    allowedActions: ["click", "type", "navigate", "waitFor", "read"],
    riskyActions: [{ route: "/member/*/subaccount/create", action: "click", policy: "block" }],
  };
}
