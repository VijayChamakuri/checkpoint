import type { Page } from "playwright";
import type { Step } from "../schema/capability.js";
import { bindParamIfMatches } from "../schema/param-binding.js";

interface TaggedInfo {
  role: string;
  name: string;
  structuralIndex: number;
  rowText: string | null;
  boundingBox: { x: number; y: number } | null;
}

async function readTaggedInfo(page: Page, ref: string): Promise<TaggedInfo> {
  const el = page.locator(`[data-agent-ref="${ref}"]`);
  const role = (await el.getAttribute("data-agent-role")) ?? "";
  const name = (await el.getAttribute("data-agent-name")) ?? "";

  const refsWithSameRoleAndName = await page.evaluate(
    ({ role: r, name: n }) => {
      return Array.from(document.querySelectorAll("[data-agent-ref]"))
        .filter((el) => el.getAttribute("data-agent-role") === r && el.getAttribute("data-agent-name") === n)
        .map((el) => el.getAttribute("data-agent-ref"));
    },
    { role, name },
  );
  const structuralIndex = refsWithSameRoleAndName.indexOf(ref);

  const rowText = await el.evaluate((element) => element.closest("tr")?.textContent?.trim() ?? null);

  const box = await el.boundingBox();
  const boundingBox = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;

  return { role, name, structuralIndex: Math.max(0, structuralIndex), rowText, boundingBox };
}

interface CellPosition {
  cellIndexInRow: number;
  labelText: string | null;
}

/**
 * For a read step specifically: the value being read (e.g. a balance) is
 * unknowable in advance for other input parameters, so it can't be the
 * locator's accessible name the way click/type targets can. Instead, locate
 * by the STABLE label in the preceding cell (a literal textMatch, not a
 * paramRef -- the label text itself never changes) and the cell's position
 * within that row.
 */
async function readCellPosition(page: Page, ref: string): Promise<CellPosition> {
  const el = page.locator(`[data-agent-ref="${ref}"]`);
  return el.evaluate((element) => {
    const row = element.closest("tr");
    if (!row) return { cellIndexInRow: 0, labelText: null };
    const cells = Array.from(row.children);
    const cellIndexInRow = cells.indexOf(element);
    const labelCell = cellIndexInRow > 0 ? cells[cellIndexInRow - 1] : null;
    return { cellIndexInRow: Math.max(0, cellIndexInRow), labelText: labelCell?.textContent?.trim() ?? null };
  });
}

/**
 * Turns a live discovery action (addressed by an ephemeral ref) into a
 * recordable, replay-independent Step: role/accessible-name/structuralPath/
 * fallbackCoordinate, with paramRef binding applied to any value that
 * matches a supplied input parameter. Refs never appear in the artifact.
 */
export async function recordStep(
  page: Page,
  action: "click" | "type" | "waitFor" | "read",
  ref: string,
  params: Record<string, unknown>,
  extra: {
    value?: string;
    extractField?: string;
    extractFrom?: "text" | "attribute";
    extractAttribute?: string;
  } = {},
): Promise<Step> {
  const info = await readTaggedInfo(page, ref);
  const framePath: string[] = [];
  const fallbackCoordinate = info.boundingBox ?? { x: 0, y: 0 };

  if (action === "read") {
    const position = await readCellPosition(page, ref);
    const locator = {
      role: info.role,
      name: "", // wildcard: the value is unknowable in advance, never matched by name
      framePath,
      structuralPath: [String(position.cellIndexInRow)],
      textMatch: position.labelText ?? undefined, // literal label, not a paramRef -- it never changes
      fallbackCoordinate,
    };
    return {
      action: "read",
      locator,
      extract: {
        field: extra.extractField ?? position.labelText ?? info.name,
        from: extra.extractFrom ?? "text",
        attribute: extra.extractAttribute,
      },
    };
  }

  const structuralPath = [String(info.structuralIndex)];
  let textMatch: string | { paramRef: string } | undefined;
  if (info.rowText) {
    for (const [name, value] of Object.entries(params)) {
      if (info.rowText.includes(String(value))) {
        textMatch = { paramRef: name };
        break;
      }
    }
  }
  const locator = { role: info.role, name: info.name, framePath, structuralPath, textMatch, fallbackCoordinate };

  if (action === "click") {
    return { action: "click", locator };
  }
  if (action === "waitFor") {
    return { action: "waitFor", locator };
  }
  // type
  const value = bindParamIfMatches(extra.value ?? "", params);
  return { action: "type", locator, value };
}

export function recordNavigateStep(url: string, params: Record<string, unknown>): Step {
  return { action: "navigate", url: bindParamIfMatches(url, params) };
}
