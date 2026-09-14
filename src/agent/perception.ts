import type { Page } from "playwright";

export interface PerceptionNode {
  ref: string;
  role: string;
  name: string;
  text?: string;
}

export interface Perception {
  url: string;
  nodes: PerceptionNode[];
  injectionFlagged: boolean;
  injectionReason?: string;
}

const MAX_NODES = 60;
const MAX_TABLE_ROWS = 8;

/**
 * Builds a pruned perception payload: interactive/labeled nodes only
 * (button, link, textbox, checkbox, heading, actionable table cells), large
 * tables windowed to the first N rows plus a marker, rather than serialized
 * in full. Tags each node with an ephemeral data-agent-ref attribute so the
 * discovery loop can address it precisely for THIS run -- refs never appear
 * in the recorded artifact; replay retargets by role/name/structuralPath
 * instead, independent of these transient tags.
 */
export async function capturePerception(page: Page): Promise<Perception> {
  const raw = await page.evaluate(
    ({ maxNodes, maxTableRows }) => {
      // tsx/esbuild's name-preservation transform wraps named function
      // bindings in a __name() helper call; page.evaluate() serializes only
      // this callback's source text, so that helper isn't defined in the
      // page's isolated execution context. Shim it locally rather than
      // fighting esbuild's transform.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__name ??= (fn: unknown) => fn;
      const accessibleName = (el: Element): string => {
        const aria = el.getAttribute("aria-label");
        if (aria) return aria.trim();
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
          const labelEl = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
          if (labelEl?.textContent) return labelEl.textContent.trim();
          if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.placeholder) {
            return el.placeholder.trim();
          }
        }
        return (el.textContent ?? "").trim().slice(0, 200);
      };

      const roleFor = (el: Element): string => {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit;
        const tagName = el.tagName.toLowerCase();
        if (tagName === "a") return "link";
        if (tagName === "button") return "button";
        if (tagName === "input") {
          const type = (el as HTMLInputElement).type;
          if (type === "checkbox") return "checkbox";
          if (type === "submit" || type === "button") return "button";
          return "textbox";
        }
        if (tagName === "select") return "combobox";
        if (tagName === "textarea") return "textbox";
        if (/^h[1-6]$/.test(tagName)) return "heading";
        if (tagName === "td" || tagName === "th") return "cell";
        if (tagName === "tr") return "row";
        return tagName;
      };

      const selector = "a, button, input, select, textarea, h1, h2, h3, h4, td, th, [role]";
      const all = Array.from(document.querySelectorAll(selector));
      const rowGroups = new Map<Element, Element[]>();
      const nonCellNodes: Element[] = [];

      for (const el of all) {
        const tagName = el.tagName.toLowerCase();
        if (tagName === "td" || tagName === "th") {
          const row = el.closest("tr");
          if (row) {
            const list = rowGroups.get(row) ?? [];
            list.push(el);
            rowGroups.set(row, list);
          }
        } else {
          nonCellNodes.push(el);
        }
      }

      const results: { ref: string; role: string; name: string; text?: string }[] = [];
      let refCounter = 0;
      const tag = (el: Element, role: string, name: string): string => {
        const ref = `n${refCounter}`;
        refCounter += 1;
        el.setAttribute("data-agent-ref", ref);
        el.setAttribute("data-agent-role", role);
        el.setAttribute("data-agent-name", name);
        return ref;
      };

      for (const el of nonCellNodes) {
        if (results.length >= maxNodes) break;
        const role = roleFor(el);
        const name = accessibleName(el);
        const ref = tag(el, role, name);
        results.push({ ref, role, name });
      }

      let rowIndex = 0;
      for (const [, cells] of rowGroups) {
        if (rowIndex >= maxTableRows) break;
        for (const cell of cells) {
          if (results.length >= maxNodes) break;
          const role = roleFor(cell);
          const name = accessibleName(cell);
          const ref = tag(cell, role, name);
          results.push({ ref, role, name });
        }
        rowIndex += 1;
      }
      const truncatedRows = rowGroups.size - rowIndex;

      return { nodes: results, truncatedRows: Math.max(0, truncatedRows) };
    },
    { maxNodes: MAX_NODES, maxTableRows: MAX_TABLE_ROWS },
  );

  const nodes: PerceptionNode[] = raw.nodes.map((n) => ({ ...n, text: n.name }));
  if (raw.truncatedRows > 0) {
    nodes.push({ ref: "__truncated__", role: "note", name: `${raw.truncatedRows} more rows not shown` });
  }

  const injection = scanForInjection(nodes);
  return {
    url: page.url(),
    nodes,
    injectionFlagged: injection.flagged,
    injectionReason: injection.reason,
  };
}

/** Heuristic tripwire: page text should not read as an instruction directed at an AI agent. */
function scanForInjection(nodes: PerceptionNode[]): { flagged: boolean; reason?: string } {
  const patterns: RegExp[] = [
    /ignore (all|previous|prior|your) (instructions?|goals?)/i,
    /disregard (the|your) (instructions?|goal)/i,
    /you are (now|actually) an? (ai|assistant|agent)/i,
    /\bsystem prompt\b/i,
    /transfer (all|the) (funds?|money|balance) to/i,
  ];
  for (const node of nodes) {
    const text = node.name ?? "";
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return { flagged: true, reason: `node ${node.ref} ("${text.slice(0, 80)}") matched pattern ${pattern}` };
      }
    }
  }
  return { flagged: false };
}

export async function resolveRef(page: Page, ref: string) {
  return page.locator(`[data-agent-ref="${ref}"]`);
}
