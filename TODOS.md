# TODOs

## Expose saved artifacts as an MCP tool server (stretch goal)

**What:** Each saved capability artifact becomes a named, typed MCP (Model Context Protocol) tool (JSON-schema args/outputs) that any MCP-compatible agent can discover and invoke by name.

**Why:** Reframes the deliverable from "a project" to "a standards-based tool server" -- each saved capability becomes something any MCP-compatible agent can discover and invoke by name, not just something this codebase happens to know how to run.

**Pros:** Strong, recognizable differentiator; relatively small addition on top of an already-typed artifact schema (Zod schemas map cleanly to JSON Schema for MCP tool definitions).

**Cons:** Extra surface area and dependency (an MCP server runtime) on top of a core that isn't required to have it. Building it before the core vertical slice is solid would be exactly the kind of premature scope that dilutes depth on what matters most.

**Context:** Considered as an alternative base architecture and rejected in favor of the single-process, headed-browser handoff design, specifically because building it into the core would read as premature infrastructure. It remains a strong candidate for the one stretch goal to attempt once the core vertical slice (goal, discovery, artifact, replay, escalation, evidence) runs end-to-end.

**Depends on:** The core (mock app, `executeAction()` gate, discovery loop, artifact schema/writer, replay executor, evidence) must be done first, per the project's cut-line.

**Priority:** P3.

## Harden prompt-injection detection beyond the keyword heuristic

**What:** Replace or augment the pattern-based prompt-injection tripwire (scans accessibility-tree text for imperative-instruction-shaped phrases before it reaches the LLM's decision context) with a more robust detection layer, e.g. a dedicated classifier pass, or a second LLM call specifically asked to judge whether page content looks like an injected instruction.

**Why:** The current heuristic is explicitly documented as evadable by adversarial content that doesn't match its pattern set. The allowlist still bounds the blast radius regardless (an injection can only steer the agent toward an already-permitted action, never past the allowlist), but detection quality itself is weak.

**Pros:** Closes a known, explicitly-documented limitation; meaningfully raises the bar for a threat class that matters a lot in a regulated-financial-data context.

**Cons:** Real, open-ended scope: robust prompt-injection detection is an active research problem, not something to attempt to fully solve here. Risks time sunk into a problem with no clean "done" state.

**Context:** Surfaced during design review of the threat model; the base mitigation (heuristic tripwire + allowlist boundary) was accepted as appropriately scoped for this deliverable. This TODO captures the acknowledged gap rather than pretending the heuristic is a complete solution.

**Depends on:** The MVP core and the heuristic version both being done first.

**Priority:** P3.
