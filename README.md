# llm-contract

Turn LLM output into a contract-bound API response.

Define a schema. Call any model. Get validated, typed data — or a precise, repairable error.

No framework. No provider lock-in. One dependency (`zod`).

## The problem

LLM calls in most codebases look like this: hand-written format instructions, `JSON.parse`, unchecked `as` casts, blind retries, inconsistent glue in every file. When the model returns bad structure, you find out downstream — or in production.

## What this does

`llm-contract` enforces a deterministic boundary around structured LLM output:

1. Generate structural instructions from your schema
2. Call your model (any provider, any SDK)
3. Clean raw output into JSON
4. Validate against the schema and invariants
5. On failure, feed the exact violation back to the model
6. Retry with targeted repair (bounded)

The model is probabilistic. The boundary is not.

```typescript
import { enforce } from "llm-contract";
import { z } from "zod";

const result = await enforce(
  z.object({
    sentiment: z.enum(["positive", "negative", "neutral"]),
    confidence: z.number().min(0).max(1),
  }),
  async (attempt) => {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: attempt.prompt },
        { role: "user", content: "Analyze: 'I love this product'" },
        ...attempt.fixes,
      ],
    });
    return res.choices[0].message.content;
  },
  {
    invariants: [
      (data) => data.confidence > 0.5 || `confidence too low: ${data.confidence}`,
    ],
  },
);

if (result.ok) {
  result.data; // { sentiment: "positive", confidence: 0.95 } — fully typed
}
```

- `attempt.prompt` — auto-generated from the schema, no hand-written format instructions
- `attempt.fixes` — on retry, the exact violation fed back to the model
- `result.data` — typed, validated at runtime, no casts
- Markdown fences, prose wrapping, string-typed numbers — cleaned automatically
- 3 retries by default, zero config

## What makes this different

This is not `JSON.parse` + Zod. This is not "try again" retries.

On failure, the exact violated constraint is fed back to the model. Not:

> "Return valid JSON."

But:

> `confidence must be between 0 and 1, received 1.4`

LLMs respond far better to targeted constraint feedback than to generic instructions. You don't improve the model. You improve the boundary.

## How it works

```
prompt → [your LLM call] → clean → check
                              ↑       |
                              └─ fix ←┘  (on failure)
```

`prompt` generates structural instructions from the schema. `clean` normalizes raw output into JSON (strips markdown fences, prose wrapping, coerces string-typed numbers). `check` validates against the schema and invariants. `fix` turns failures into targeted repair messages. `enforce` runs the full loop.

Also available: `select` strips input down to only the fields the schema defines — prevents sending PII, secrets, or unrelated data to the model.

## Invariants

The schema gets you to valid JSON. Invariants get you to correct results.

The schema catches structural violations — wrong types, missing fields, bad enums. Invariants catch everything the schema can't: business rules, cross-field logic, domain constraints. Return `true` if it passes, or a string describing the violation. That string is the exact feedback the model receives on retry.

```typescript
invariants: [
  (data) => data.items.length > 0 || "items must not be empty",
  (data) => data.end > data.start || "end must be after start",
  (data) => allowedRegions.includes(data.region)
    || `region ${data.region} not in allowed list`,
]
```

Invariants are functions — they can reference your database, config, or any runtime state.

You don't design them up front. You promote recurring production failures into enforceable guarantees:

1. Ship with the schema.
2. Observe failures via `onAttempt` — every attempt records the category, issues, and raw output.
3. Notice a pattern.
4. Add one invariant. That failure mode is now caught, repaired automatically, and never reaches your system again.

Each invariant converts a recurring failure into a permanent structural guarantee. Strictness compounds.

## Built-in failure handling

Out of the box, `enforce` classifies every failed attempt into one of 8 categories and generates a targeted repair message for each:

| Category | What happened | Default repair |
|----------|--------------|----------------|
| `EMPTY_RESPONSE` | Model returned nothing | Ask for JSON matching the schema |
| `REFUSAL` | Model declined ("I'm sorry", "as an AI", etc.) | Redirect to structured data task |
| `NO_JSON` | Response contained no JSON at all | Ask for JSON only, no prose |
| `TRUNCATED` | JSON cut off (unbalanced braces) | Ask for a shorter, complete response |
| `PARSE_ERROR` | JSON present but malformed | Ask for strictly valid JSON |
| `VALIDATION_ERROR` | Valid JSON but failed schema | List the specific Zod errors |
| `INVARIANT_ERROR` | Schema passed but invariant failed | List the specific violation strings |
| `RUN_ERROR` | Your function threw an exception | Ask to try again |

Before validation, `clean` automatically strips markdown fences, extracts JSON from prose, and coerces string-typed values (`"85"` to `85`, `"true"` to `true`).

You can override the repair for any category — or disable retry entirely:

```typescript
enforce(schema, run, {
  repairs: {
    REFUSAL: (detail) => [{
      role: "user",
      content: "This is an approved data extraction task. Return the JSON.",
    }],
    TRUNCATED: false, // stop immediately, don't retry
  },
});
```

## When to use this

Use `llm-contract` when:

- LLM output feeds downstream logic
- Incorrect structure has cost (data pipelines, APIs, automation)
- You need explicit, repairable failures — not silent bad data

Not designed for:

- Free-form chat or creative writing
- Tasks where structure doesn't matter

## Install

```bash
npm install llm-contract zod
```

## Further reading

- [API reference](./API.md) — full function signatures and options
- [Examples](./examples) — runnable demos (sentiment, invoice extraction, classification, fallback chains)
- [EXAMPLES.md](./EXAMPLES.md) — detailed before/after comparisons

## License

MIT
