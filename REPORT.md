# Design Report: Checkpoint

## 1. Architecture

Single process, no database, no queue, no microservices. One Node/TypeScript
process runs the discovery loop, the artifact store (versioned JSON files on
disk), and the replay executor; Playwright drives a real (headed) browser.
Appropriate simplicity is prioritized over "scaling infrastructure" that
isn't earning its keep yet -- this is the smallest architecture that still
satisfies every core requirement.

```
DISCOVERY                    ARTIFACT                 REPLAY                    ESCALATION
LLM tool-          success   Capability      invoke    Replay executor  stuck    Human takes
calling loop  ---------->    (Zod, v1)     -------->   (no LLM)       -------->  over session
over AX-tree               steps+locator             checkpoint      <--------   + resume
perception    <-- escalate  +checkpoint               verify, error   resume    signal
                                                       taxonomy

     executeAction() -- allowlist + accessibility-tree primitives -- shared by both callers
```

The seam that matters architecturally is `executeAction()`
(`src/core/execute-action.ts`): every UI action, from either the discovery
loop or the replay executor, goes through this one function, which checks
the allowlist before dispatching to Playwright. That's the actual safety
boundary, not a convention two call sites happen to follow.

**Production seam, stated explicitly:** escalation hands control to a human
by letting them drive the same *headed* browser window directly. That's a
demo simplification appropriate to a single local process, not the
production answer -- a real deployment would hand off over a remote session
transport (e.g. CDP-over-websocket) so the human never needs local machine
access. The control-transfer *model* (block, snapshot state, diff on resume)
is the same either way; only the transport changes.

## 2. Artifact schema

A capability is a typed, versioned contract, not a recording:

```ts
Capability {
  id, version, name, description
  target: { app, entryUrl }
  inputSchema: ObjectSchema   // e.g. { memberId: { type: "string" } }
  outputSchema: ObjectSchema  // e.g. { savings_balance: { type: "string" } }
  steps: Step[]
  checkpoint: Checkpoint
  createdAt, sourceRunId
}
```

`inputSchema`/`outputSchema` are a small JSON-Schema-like shape, not an
embedded Zod object -- the artifact is plain, inspectable JSON; Zod only
validates the artifact file's *structure*, plus a small hand-written
`validateParams()` for input *values* at replay time.

The piece that took the most iteration -- and that an earlier review pass
found completely unwired -- is **parameterization**. `Step.value` and
`locator.textMatch` can each be a literal or `{ paramRef: "memberId" }`. At
discovery time the goal is filled with concrete values before the LLM sees
it, and the writer replaces any typed value or matched row-text that exactly
equals a supplied parameter with a `paramRef`. At replay time this runs in
reverse. This is what makes "replay with a different member ID" actually
locate the right row and type the right value, instead of silently replaying
the originally-recorded member every time -- demonstrated, not just
asserted: replaying the same saved artifact with `memberId: "10045"` and
`"10023"` returns two different, correct balances (`/evidence/`,
`tests/unit/replay-executor.test.ts`).

**Locator identity: accessibility-tree-primary, not CSS selectors.** Each
`Locator` is `{ role, name, framePath, structuralPath, textMatch?,
fallbackCoordinate }`. Role + accessible name is the primary match; when
that resolves to more than one element, disambiguation goes (1) `textMatch`
-- the row whose visible text contains the *current* parameter value, so
it's correct across different replay inputs, not just the recorded one; (2)
`structuralPath` -- index among matches at discovery time, for elements with
no parameter-bound content; (3) proximity to a recorded `fallbackCoordinate`,
as the last resort. None of the three resolving to exactly one element is a
hard failure, never a silent guess.

This was deliberately not Playwright's `getByRole().nth()`: a bare
positional index breaks the moment a row is inserted, removed, or the table
re-sorts between record and replay. Building this caught a real bug: the
mock app's own hostile, table-based *layout* means every ancestor `<tr>`
also carries `role="row"`, so a naive "row containing this text" query
matched nested wrapper rows, not just the genuine data row. Fix: exclude
rows that themselves contain a nested row.

A `read` step is the other place accessible name can't be the match key --
the value being read is unknowable in advance for other parameters. Those
locators use an empty ("wildcard") name, a `textMatch` on the *stable
label* next to the value (a literal, since the label never changes), and a
`structuralPath` index for which cell holds the value.

## 3. Determinism & error handling

Replay never invokes the LLM. Every step resolves via the locator chain
above; the same `verifyCheckpoint()` runs after a successful replay *and*
after an escalation handoff resumes -- it doesn't care who produced the
current state, only whether the declared condition is now true.

The result contract has five named classes, checked in order, never a
catch-all:

| Class | Meaning | Handling |
|---|---|---|
| `InvalidInput` | Caller's params fail schema validation | Rejected before any browser action runs |
| `LLMCallFailure` | The LLM API call times out, rate-limits, or returns something malformed/refused (discovery only) | Timeout/429: bounded retry (2 attempts). Malformed/refusal: escalate |
| `BusinessOutcome` | Expected app-level result (`member_not_found`, `permission_denied`, `session_expired`, a validation error) | Returned as `{outcome: "business", ...}`, never a crash |
| `RecoverableCondition` | A known dismissible state (e.g. an interstitial notice) | Dismissed, bounded retry (2 attempts); exhausting the bound converts it to a hard failure |
| `HardFailure` | Checkpoint never satisfied, an out-of-policy action, or a locator that never resolved | Stop, structured debug detail: which step, what was expected, what was observed |

Business outcomes and recoverable conditions are detected against a small,
app-specific pattern registry (`src/replay/known-patterns.ts`) matched on
page text -- extending to a new target app means adding entries there, not
touching the executor. Demonstrated: replaying against a non-existent member
ID returns a clean `BusinessOutcome`, not a crash, with a screenshot
alongside the log (`/evidence/`).

Discovery's own stopping conditions cover all three the brief names: max
steps, a wall-clock timeout, and "dead-end" (no page-state change for N
consecutive actions) -- any of the three escalates rather than looping
forever.

**UI drift**, secondarily: accessibility-tree locators are inherently more
resilient to incidental layout/markup drift than CSS selectors, since they
depend on role/name/label semantics, not DOM structure. Not drift-proof --
if accessible roles or labels themselves change, replay correctly reports a
hard failure rather than guessing.

## 4. Heterogeneity & multi-tenant

Built and tested against one surface; designed, not built, against the rest.

**Surface abstraction.** The seam between "how we perceive/act on a surface"
and "the recorded flow" is the `Locator` type itself: role, accessible name,
frame path. Both concepts exist on native desktop apps too (the OS
accessibility API exposes role/name the same way a browser's does for
HTML), so the *artifact schema* wouldn't need to change to add a desktop
surface -- only the actuation layer under `executeAction()` would swap for
an OS automation API behind the same interface. A legacy web app with
framesets has a place to land: the `Locator` schema already carries a
`framePath` field, and `resolve-locator.ts` already walks it to find the
right frame before resolving an element inside it. What's not built yet is
the discovery side: `record-step.ts` always records an empty `framePath`,
even for an element inside the mock app's iframe, so today every capability
is recorded as if everything lives in the top-level document. Wiring
discovery to detect and record the actual frame chain is the remaining
piece, not a schema change.

**Multi-tenant reuse.** Hundreds of tenants on the same vendor product,
differently configured, is fundamentally a canonicalization problem: two
tenants' "same" screen differs in concrete values but shares structure. The
`paramRef` mechanism already built for per-invocation parameters generalizes
directly to per-tenant overrides -- a capability recorded on a "base" tenant
applies to another by treating tenant-specific differences as another bound
reference, not a hardcoded literal. Drift detection reuses the same
`HardFailure` signal replay already produces when a locator or checkpoint
stops resolving, surfaced per-tenant instead of per-run. None of this is
built; the abstractions just don't paint the system into a corner.

## 5. Escalation & handoff

Stuck detection escalates on any of: N consecutive actions with no
page-state change, a hard failure during discovery, the model calling an
explicit `request_human` tool (so it can self-report low confidence instead
of guessing), max steps or timeout reached, or the prompt-injection tripwire
below.

The handoff mechanism is deliberately minimal: a full co-browsing console is
out of scope as long as the handoff itself is real, so the agent process
blocks on a tiny local HTTP listener (`POST /resume`); the human takes the
mouse/keyboard on the *same* visible browser window, acts, and hits resume.
Before ceding control, the run's state (run id, step index, control owner,
params, last checkpoint) is snapshotted atomically to disk; an incomplete
snapshot found on process start can be resumed rather than silently lost.
An accessibility-tree-and-URL snapshot is taken before and after the
handoff, so what the human changed is captured as a diff, not asserted.
`escalateAndAwaitResume()` takes an optional checkpoint, and when one is
passed, it runs it through the exact same `verifyCheckpoint()` the replay
executor uses, against whatever state the human left the page in -- one code
path, not a special "trust the human" branch. Today's only call site is
discovery's own escalation, and discovery derives its checkpoint from the
final page state only after the run succeeds, so there's nothing to check
yet at that point and the field comes back empty. A replay-time escalation
would have a real checkpoint already and would get a real true/false here;
that call site isn't built, since replay in this deliverable fails hard and
reports the outcome rather than handing off to a human mid-replay.

Tested, not just described: `tests/unit/handoff.test.ts` starts a handoff,
confirms it does *not* resolve before the resume signal arrives, has a
"human" (the test itself) navigate the same live page, sends the resume
signal, and asserts the before/after diff and run-state transitions.

## 6. Safety

**Allowlist**, enforced once, centrally, in `executeAction()`: permitted
routes/action types, plus risky-action rules with a `block` or
`require-confirmation` policy. Reaching the sub-account confirmation screen
is allowed (the goal is to reach it, not submit it); the final "Confirm &
Create" submit is `block`ed outright, and non-mutating *by construction*:
the confirmation screen renders from in-memory form state only, and the
backing store is written exactly once, by the action blocked.

**Prompt injection.** Page content is data, not instructions -- but nothing
stops adversarial page text reading as a command. Before accessibility-tree
text reaches the LLM's context, it passes a heuristic scan for
imperative-instruction-shaped patterns; a match forces escalation through
the same handoff mechanism, rather than silently filtering. A tripwire, not
a guarantee: the allowlist boundary holds regardless of whether the
heuristic catches a given attempt (injection steers toward an
already-permitted action, never past it); a more robust detector is
tracked in `TODOS.md`.

**Redaction.** One shared `redact()` function, called by the artifact writer
and the JSONL logger before anything touches disk: a field-name denylist
(`ssn`, `account`, `routing`, `password`, `token`, `credential`; `memberId`
explicitly allowlisted as a parameter, not a secret) plus a regex backstop
for SSN/card/token-shaped values in unexpected fields. This caught its own
bug: the card-number pattern initially flagged the system's own 13-digit
`runId` timestamp as sensitive (structurally indistinguishable from a card
number) -- fixed by allowlisting known-safe identifiers
(`tests/unit/redact.test.ts` has the regression test). Honest limit: a
sensitive value shaped differently than either layer expects can still slip
through -- documented, not silent.

## 7. Cuts

- **Multi-tenant and desktop implementations.** Design story only (Section 4).
- **A robust prompt-injection classifier.** The heuristic scan plus the
  allowlist boundary is the appropriately-scoped mitigation here; a more
  robust detector (`TODOS.md`) is an open research problem, not a
  well-defined task for this scope.
- **An MCP tool server exposing artifacts as callable tools.** Considered as
  the base architecture, rejected, kept as the one stretch-goal candidate
  (`TODOS.md`) -- depth on the core vertical slice matters more.
- **A separate `@playwright/test` E2E suite.** The vitest suite already
  drives a real headless Chromium against the real, live mock app for every
  scenario that matters; a parallel suite would be redundant, not more
  rigorous.
- **An event-log-backed core (SQLite).** Rejected as the base architecture:
  unnecessary infrastructure for this scope; evidence/observability is
  already satisfied by structured JSONL logs plus failure screenshots.
- **Multi-run stability scoring, code generation from artifacts,
  confidence/approval gating.** Optional stretch goals not attempted, in
  favor of full depth on the six core requirements.

Kept despite adding scope: run-state persistence for crash-during-handoff
recovery, and the full three-tier disambiguation chain rather than a
simpler `nth()`-only locator. Both were flagged during review as arguably
more than strictly necessary, and kept anyway because they closed a real
correctness or safety gap the review actually found.
