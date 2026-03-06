# llm-contract

Deterministic reliability boundary for structured LLM output.

Treat model output as untrusted input.  
Accept it only if it passes runtime checks, or fail explicitly.

## What problem this solves

If LLM output flows into downstream logic, brittle output handling becomes production risk.

Typical path today:

- call model
- `JSON.parse` response
- run ad hoc checks
- retry with generic feedback

Typical failures:

- malformed JSON
- schema mismatches
- cross-field contradictions
- retries that do not converge
- silent wrong data reaching business logic

## What llm-contract guarantees

`llm-contract` wraps model output with a deterministic boundary:

- `clean -> check(schema + invariants) -> classify -> repair -> retry`
- accepted output always passed runtime checks
- return value is always either typed success or explicit structured failure

## Quickstart

```bash
npm install llm-contract zod
```

```typescript
import { enforce } from "llm-contract";
import { z } from "zod";

const schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
});

const result = await enforce(
  schema,
  async (attempt) => {
    const res = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        { role: "system", content: attempt.prompt },
        { role: "user", content: "Analyze: I love this product" },
        ...attempt.fixes,
      ],
    });
    return res.output_text;
  },
  {
    invariants: [
      (d) => d.confidence > 0.5 || `confidence too low: ${d.confidence}`,
    ],
  },
);

if (!result.ok) {
  console.error(result.error.message);
  console.error(result.error.attempts);
  return;
}

console.log(result.data);
```

## Failure model

Every failed attempt is explicitly categorized:

- `EMPTY_RESPONSE`
- `REFUSAL`
- `NO_JSON`
- `TRUNCATED`
- `PARSE_ERROR`
- `VALIDATION_ERROR`
- `INVARIANT_ERROR`
- `RUN_ERROR`

Each category maps to targeted repair behavior. You can override or disable repairs per category.

## Invariants

Schema validates shape and types. Invariants validate domain correctness.

Example:

```typescript
(d) => Math.abs(d.subtotal + d.tax - d.total) < 0.01
  || `subtotal (${d.subtotal}) + tax (${d.tax}) != total (${d.total})`
```

Invariant violations are rejected, fed back to the model, and retried within policy.

## Observability and operability

Use `onAttempt` to inspect each attempt:

- pass/fail status
- failure category
- issues
- duration

This makes failure patterns measurable and debuggable in real systems.

## Non-goals

`llm-contract` is not:

- an LLM framework
- an agent runtime
- an orchestration system
- a replacement for prompt engineering

It focuses on one problem: reliable structured output boundaries.

## Documentation

- [Overview](https://operatorstack.github.io/llm-contract/)
- [Quickstart](https://operatorstack.github.io/llm-contract/quickstart)
- [How It Works](https://operatorstack.github.io/llm-contract/how-it-works)
- [Core API](https://operatorstack.github.io/llm-contract/api)
- [Invariants](https://operatorstack.github.io/llm-contract/invariants)
- [Failure Model](https://operatorstack.github.io/llm-contract/failure-model)
- [Observability](https://operatorstack.github.io/llm-contract/observability)
- [Examples](https://operatorstack.github.io/llm-contract/examples)

## Repository examples

- [examples/extraction.ts](./examples/extraction.ts)
- [examples/classification.ts](./examples/classification.ts)
- [examples/scoring.ts](./examples/scoring.ts)
- [examples/integration-langfuse.ts](./examples/integration-langfuse.ts)
- [examples/integration-otel.ts](./examples/integration-otel.ts)
- [examples/integration-vercel-ai.ts](./examples/integration-vercel-ai.ts)

## Status

Preview release.

Core contract loop is stable. APIs may evolve as failure patterns are refined.

## License

MIT
