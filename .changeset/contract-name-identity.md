---
"@withboundary/contract": minor
---

Require a `name` on every contract and propagate it through every logger hook.

- `defineContract({ name, schema, ... })` now requires `name: string`. The runtime throws `TypeError` if it's missing or blank.
- `enforce(schema, run, options)` now requires `options.name`.
- Every `ContractLogger<T>` hook context carries `contractName: string`, so loggers can attribute every event to the right contract without holding a separate reference. This is what `@withboundary/sdk` reads to populate `BoundaryLogEvent.contractName`.
- `createConsoleLogger` prints the contract name in each line: `[boundary] lead-scoring · Run started`.
- New public type export: `BoundaryLogEvent` — the wire format that observability SDKs ship to Boundary cloud.
- Renamed `onRunStart` ctx field `hasInvariants` → `hasRules` to match the config key (`rules`). The old name was never aligned and no code relied on it since the dispatcher was untyped.

This is a type-level breaking change for anyone who had `defineContract({ schema, rules })` without a name. Add `name: "your-contract"` to existing calls — pick something you'd want to see on the Boundary dashboard.
