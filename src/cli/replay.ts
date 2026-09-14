import { chromium } from "playwright";
import { replay } from "../replay/executor.js";
import { establishSession } from "../core/session.js";
import { ArtifactStore } from "../schema/artifact-store.js";
import { ActionLog } from "../logging/action-log.js";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i];
    if (entry?.startsWith("--")) {
      const key = entry.slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? next : "true";
      if (next && !next.startsWith("--")) i += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const baseUrl = args["base-url"] ?? `http://localhost:${process.env.MOCK_APP_PORT ?? 4100}`;
  const params: Record<string, unknown> = args.params ? JSON.parse(args.params) : {};

  if (!args.artifact && !args.name) {
    console.error(
      'Usage: npm run replay -- --artifact artifacts/lookup-member-balance.v1.json --params \'{"memberId":"10045"}\'',
    );
    process.exit(1);
  }

  const store = new ArtifactStore("artifacts");
  const capability = args.artifact
    ? store.loadFromPath(args.artifact)
    : store.load(args.name!, args.version ? Number(args.version) : undefined);

  console.log(`Replaying capability "${capability.name}" v${capability.version} with params ${JSON.stringify(params)}`);

  const runId = `replay-${Date.now()}`;
  const log = new ActionLog(`evidence/${runId}.jsonl`);

  const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" });
  const context = await browser.newContext();
  const page = await context.newPage();
  await establishSession(page, baseUrl);

  const result = await replay(page, capability, params, log, runId);

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.outcome === "success" || result.outcome === "business" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
