import type { Frame, FrameLocator, Locator as PWLocator, Page } from "playwright";
import type { Locator } from "../schema/capability.js";
import { resolveParam } from "../schema/param-binding.js";
import { LocatorResolutionError } from "./errors.js";

type Root = Page | Frame | FrameLocator;

function resolveFrameRoot(page: Page, framePath: string[]): Root {
  let root: Root = page;
  for (const selector of framePath) {
    root = "frameLocator" in root ? root.frameLocator(selector) : (root as FrameLocator).frameLocator(selector);
  }
  return root;
}

/**
 * An empty name is a deliberate wildcard: it means "match by role only,
 * disambiguate by textMatch/structuralPath instead." This is what lets a
 * read step target a value cell whose own text is unknowable in advance
 * (e.g. a balance) -- it locates the row by a stable label (textMatch) and
 * the cell by position (structuralPath), never by the value itself.
 */
function queryByRole(root: Root | PWLocator, role: string, name: string): PWLocator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return name ? root.getByRole(role as any, { name }) : root.getByRole(role as any);
}

/**
 * Disambiguation chain: role+name match, then (1) textMatch against the
 * *current* parameter value, (2) structuralPath (index among matches at
 * discovery time), (3) proximity to the recorded fallbackCoordinate. Zero
 * initial matches is an immediate hard failure -- there is nothing to
 * disambiguate among. This is a deliberately simplified structuralPath
 * (index among role+name matches, not a full nearest-labeled-ancestor
 * computation) -- documented as a scoped simplification in REPORT.md.
 */
export async function resolveLocator(
  page: Page,
  locator: Locator,
  params: Record<string, unknown>,
): Promise<PWLocator> {
  const root = resolveFrameRoot(page, locator.framePath);
  const candidates = queryByRole(root, locator.role, locator.name);
  const count = await candidates.count();

  if (count === 0) {
    throw new LocatorResolutionError(
      `no element found for role="${locator.role}" name="${locator.name}"`,
      0,
    );
  }
  if (count === 1) return candidates.first();

  if (locator.textMatch !== undefined) {
    // "The row whose visible text contains the parameter value" -- the
    // disambiguating text usually lives in a sibling cell (e.g. the member
    // name/ID next to a "View" link), not in the target element's own text,
    // so scope by the nearest table-row ancestor rather than the element itself.
    // On a table-based LAYOUT (hostile markup, deliberately), every ancestor
    // <tr> also carries role="row" and therefore also "contains" the text --
    // exclude rows that themselves contain a nested row, leaving only the
    // innermost, genuine data row.
    const text = resolveParam(locator.textMatch, params);
    const anyRow = root.getByRole("row");
    const row = anyRow.filter({ hasText: text }).filter({ hasNot: anyRow });
    const scoped = queryByRole(row, locator.role, locator.name);
    const scopedCount = await scoped.count();
    if (scopedCount === 1) return scoped.first();
    if (scopedCount > 1) return resolveByStructuralPathOrCoordinate(scoped, scopedCount, locator);
  }

  return resolveByStructuralPathOrCoordinate(candidates, count, locator);
}

async function resolveByStructuralPathOrCoordinate(
  candidates: PWLocator,
  count: number,
  locator: Locator,
): Promise<PWLocator> {
  const lastPathSegment = locator.structuralPath[locator.structuralPath.length - 1];
  const idx = lastPathSegment !== undefined ? Number(lastPathSegment) : NaN;
  if (!Number.isNaN(idx) && idx >= 0 && idx < count) {
    return candidates.nth(idx);
  }

  let closestIndex = -1;
  let closestDistance = Infinity;
  for (let i = 0; i < count; i += 1) {
    const box = await candidates.nth(i).boundingBox();
    if (!box) continue;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const distance = Math.hypot(cx - locator.fallbackCoordinate.x, cy - locator.fallbackCoordinate.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  }
  if (closestIndex === -1) {
    throw new LocatorResolutionError(
      `${count} candidates for role="${locator.role}" name="${locator.name}" but none resolved to a unique element`,
      count,
    );
  }
  return candidates.nth(closestIndex);
}
