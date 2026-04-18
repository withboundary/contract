---
"@withboundary/contract": minor
---

Add `model` and `rulesCount` observability fields.

- `BoundaryLogEvent` gains optional `model?: string` and `rulesCount?: number` so sinks can attribute events to a specific LLM and record the active rule count per run.
- `ContractOptions` gains optional `model?: string` for a per-call override (`contract.accept(run, { model })`). The value flows through to the logger's `onRunStart` hook context.
- **Breaking (hook contract):** `ContractLogger.onRunStart` ctx now exposes `rulesCount: number` instead of `hasRules: boolean`, plus an optional `model?: string`. Custom loggers reading `ctx.hasRules` need to switch to `ctx.rulesCount > 0`.
- `createConsoleLogger` prints the rule count and, when set, the model on each run.
