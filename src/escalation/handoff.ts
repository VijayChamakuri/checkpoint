import { createServer, type Server } from "node:http";
import type { Page } from "playwright";
import { capturePerception } from "../agent/perception.js";
import { RunStateStore, type RunState } from "./run-state.js";
import type { ActionLog } from "../logging/action-log.js";
import { verifyCheckpoint } from "../core/checkpoint.js";
import type { Checkpoint } from "../schema/capability.js";

export interface HandoffSummary {
  reason: string;
  urlBefore: string;
  urlAfter: string;
  nodesChanged: number;
  humanActedOnSameSession: true;
  /**
   * Only present when the caller passed a checkpoint to verify. Discovery's
   * own escalation call site has nothing to check yet at that point --
   * the checkpoint only gets derived once discovery finishes -- so this
   * stays undefined there. A replay-time escalation, which does have a
   * real checkpoint already, would get a real true/false here.
   */
  checkpointOk?: boolean;
}

const RESUME_PORT = Number(process.env.RESUME_PORT ?? 4102);

/**
 * The whole "operator surface" for this deliverable: a tiny local HTTP
 * listener the agent process blocks on, so the human resumes the SAME live
 * session (the same headed browser window), not a fresh one. Deliberately
 * minimal: a mocked operator UI is fine as long as the handoff mechanism
 * itself is real.
 */
export async function escalateAndAwaitResume(
  page: Page,
  reason: string,
  state: RunState,
  store: RunStateStore,
  log: ActionLog,
  checkpoint?: Checkpoint,
): Promise<HandoffSummary> {
  const before = await capturePerception(page);
  store.save({ ...state, control: "human", updatedAt: new Date().toISOString() });
  log.write({ runId: state.runId, phase: "escalation", event: "handoff-start", detail: { reason, url: before.url } });

  console.log("\n=== HUMAN ESCALATION ===");
  console.log(`Reason: ${reason}`);
  console.log(`The browser window is live at: ${before.url}`);
  console.log("Take over the SAME window with your own mouse/keyboard, then resume with:");
  console.log(`  curl -X POST http://localhost:${RESUME_PORT}/resume`);
  console.log("=========================\n");

  await waitForResumeSignal();

  const after = await capturePerception(page);
  const beforeRefs = new Set(before.nodes.map((n) => `${n.role}:${n.name}`));
  const afterRefs = new Set(after.nodes.map((n) => `${n.role}:${n.name}`));
  const nodesChanged = [...beforeRefs].filter((n) => !afterRefs.has(n)).length + [...afterRefs].filter((n) => !beforeRefs.has(n)).length;

  // If the caller has a checkpoint to check (it won't during discovery,
  // which derives its checkpoint only after the run finishes), verify it
  // against whatever state the human actually left the page in -- the same
  // function replay uses, not a separate "trust the human" check.
  const checkpointOk = checkpoint ? await verifyCheckpoint(page, checkpoint, state.params) : undefined;

  const summary: HandoffSummary = {
    reason,
    urlBefore: before.url,
    urlAfter: after.url,
    nodesChanged,
    humanActedOnSameSession: true,
    ...(checkpointOk !== undefined ? { checkpointOk } : {}),
  };
  store.save({ ...state, control: "agent", updatedAt: new Date().toISOString() });
  log.write({ runId: state.runId, phase: "escalation", event: "handoff-resumed", detail: { ...summary } });
  return summary;
}

function waitForResumeSignal(): Promise<void> {
  return new Promise((resolve) => {
    let server: Server;
    server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/resume") {
        // Connection: close matters here, not just as cleanup -- Node's http
        // server keeps a connection alive by default, and server.close()
        // only stops accepting NEW connections, it doesn't drop existing
        // ones. Without this header, a keep-alive client whose connection
        // survives across two escalations in the same process could have
        // its second /resume request served by this stale, already-closing
        // server instead of the new one actually listening for it -- the
        // real resume signal would then never arrive. Forcing the socket
        // closed after this response rules that out.
        res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
        res.end(JSON.stringify({ resumed: true }));
        server.close();
        resolve();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(RESUME_PORT);
  });
}
