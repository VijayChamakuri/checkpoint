# Evidence

A genuine LLM-driven discovery run, plus two replays of the artifact it produced.

**Saved artifact:** [`../artifacts/lookup-member-balance.v1.json`](../artifacts/lookup-member-balance.v1.json)

## 1. Discovery run

Goal: `look up member 10023 and read their current savings balance`

- [`discover-1789351433416.jsonl`](discover-1789351433416.jsonl) -- structured log: what the agent did, why (each step carries the model's own one-sentence rationale), and the resulting URL
- [`discovery-console.log`](discovery-console.log) -- console output, ending in the saved artifact path and extracted outputs

## 2. Clean replay -- a DIFFERENT member than the one recorded

Proves the artifact's parameterization actually works, not just the one input it was recorded with.

- [`replay-1789351457282.jsonl`](replay-1789351457282.jsonl) -- structured log
- [`replay-clean-console.log`](replay-clean-console.log) -- console output: `{"outcome":"success","outputs":{"savings_balance":"$812.10"}}`

## 3. Replay hitting an injected error -- a member that doesn't exist

Demonstrates the error taxonomy: this is classified as a `BusinessOutcome`, not a crash.

- [`replay-1789351465010.jsonl`](replay-1789351465010.jsonl) -- structured log
- [`replay-1789351465010-business-outcome.png`](replay-1789351465010-business-outcome.png) -- screenshot captured on the non-success outcome
- [`replay-error-console.log`](replay-error-console.log) -- console output: `{"outcome":"business","businessOutcome":"member_not_found",...}`

Reproduce any of these yourself with the exact commands in `/README.md`.
