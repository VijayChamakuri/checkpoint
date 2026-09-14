# Checkpoint

A backend integration layer that lets an AI agent operate a legacy back-office
web application that has no API: an LLM ("computer use") discovers how to
accomplish a goal once, records what it learned as a typed, versioned,
parameterized capability artifact, and replays that artifact deterministically
(no LLM in the loop) on every subsequent invocation -- with a real
human-escalation path when it gets stuck.

See `REPORT.md` for the design write-up (architecture, artifact schema,
determinism, escalation, safety, cuts) and `TODOS.md` for deliberately
deferred stretch work.

## Setup

Requirements: Node.js 20+, npm.

```bash
npm install
npx playwright install chromium
```

You'll need your own Anthropic API key for the discovery step (replay never
calls the LLM and doesn't need one). Put it in a local `.env` file (already
gitignored, never commit it):

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

## Demo path

Two terminals: one running the mock back-office app (the proxy target this
system operates), one driving the agent/CLI against it.

**Terminal 1 -- start the target application:**

```bash
npm run mock-app
```

This starts an intentionally hostile legacy-style mock "Member Services
Console" at `http://localhost:4100` -- table-based layout, deeply nested
markup, no `data-testid` attributes, one iframe, native semantic HTML
throughout. In-memory data, reseeded to a fixed set of fixtures every time
you restart it (member IDs `10023`, `10045`, `20099`, `90001`).

**Terminal 2 -- run the agent:**

```bash
# 1. Discovery: a genuine LLM-driven run that figures out the flow and saves it
npm run discover -- \
  --name lookup-member-balance \
  --goal "look up member {{memberId}} and read their current savings balance" \
  --description "Search for a member by ID and read their current savings balance." \
  --params '{"memberId":"10023"}'

# -> saves artifacts/lookup-member-balance.v1.json

# 2. Replay: deterministic, no LLM, works with a DIFFERENT member than was recorded
npm run replay -- \
  --artifact artifacts/lookup-member-balance.v1.json \
  --params '{"memberId":"10045"}'

# 3. Replay hitting an injected error (a member that doesn't exist)
npm run replay -- \
  --artifact artifacts/lookup-member-balance.v1.json \
  --params '{"memberId":"99999"}'
```

Each run writes a structured, redacted JSONL log to `evidence/`, plus a
screenshot for any non-success replay outcome. See `/evidence/` for a
captured example of all three runs above, and `/artifacts/` for the saved
capability.

### Running without live services

`npm test` (the unit/integration suite) needs a browser (installed above) but
not the Anthropic API -- it drives the real mock app headlessly and never
calls the LLM. Only `npm run discover` needs `ANTHROPIC_API_KEY`; `npm run
replay` needs neither the key nor a live LLM, only the mock app running.

### Escalation demo

If the agent gets stuck (or you want to see the handoff directly), it prints
a `curl` command that hands control back:

```
=== HUMAN ESCALATION ===
Reason: ...
The browser window is live at: http://localhost:4100/...
Take over the SAME window with your own mouse/keyboard, then resume with:
  curl -X POST http://localhost:4102/resume
=========================
```

The agent process blocks on that exact signal -- it does not poll or time out
on its own. `tests/unit/handoff.test.ts` exercises this mechanism end to end
(block, human acts on the live session, resume, state diff captured).

## Testing

```bash
npm test        # vitest -- drives a real headless Chromium against the real mock app
npm run typecheck
```

The suite exercises the mock app, the shared `executeAction()` allowlist
gate, locator disambiguation (including a real nested-table ambiguity bug it
caught and fixed), the artifact store, parameter validation, redaction, the
replay executor's full error taxonomy against the live app (including
replaying the same capability with two different member IDs and getting two
different correct results), and the escalation handoff. A separate
`@playwright/test` E2E suite was deliberately not added on top of this: these
tests already drive a real browser against the real live app end to end, so a
parallel suite would assert the same things a second way -- see `REPORT.md`
Cuts.

## Project layout

```
src/mock-app/     the proxy target (hostile legacy-style mock back-office app)
src/schema/       artifact schema (Zod), allowlist, param-binding, artifact store
src/core/         executeAction() gate, locator resolution, checkpoint, session
src/agent/        discovery loop, perception, LLM tool-calling, step recording
src/replay/       deterministic replay executor, known business/recoverable patterns
src/escalation/   run-state persistence, human handoff (blocking resume signal)
src/logging/      structured JSONL action log, redact()
src/cli/          discover / replay entry points
tests/unit/       vitest suite (real headless browser against the real mock app)
artifacts/        saved capability artifacts (versioned JSON)
evidence/         captured discovery/replay run logs, console output, screenshots
```
