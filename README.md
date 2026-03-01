# llm-contract

Validate, repair, and retry structured LLM output — automatically.

Define a Zod schema. Call any model. Get typed data back, or a precise error with the exact violation. When the model returns bad structure, `llm-contract` feeds the specific failure back and retries — no manual prompt tweaking, no blind retries.

No framework. No provider lock-in. One dependency (`zod`).

## The problem

LLM calls in most codebases look like this: hand-written format instructions, `JSON.parse`, unchecked `as` casts, blind retries, inconsistent glue in every file. When the model returns bad structure — wrong types, missing fields, invalid ranges — you find out downstream. Or in production.

## What this does

`llm-contract` wraps your existing LLM call with a deterministic contract:

1. Generate structural instructions from your schema
2. Call your model (any provider, any SDK)
3. Clean raw output into JSON
4. Validate against the schema (types, fields, enums, invariants)
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

On failure, the exact violated constraint is fed back to the model. Not "return valid JSON" — but the specific issue:

> `confidence must be between 0 and 1, received 1.4`

LLMs correct far more reliably with targeted feedback than with generic instructions. The model doesn't change. The boundary gets smarter.

## How it works

```
prompt → [your LLM call] → clean → check
                              ↑       |
                              └─ fix ←┘  (on failure)
```

Each step is an independent function you can use on its own:

- **`prompt`** — generates format instructions from the schema
- **`clean`** — normalizes raw output into JSON (strips markdown fences, coerces types)
- **`check`** — validates against the schema and invariants
- **`fix`** — turns failures into targeted repair messages
- **`select`** — strips input to only the fields the schema defines (no PII, secrets, or unrelated data sent to the model)
- **`classify`** — categorizes failures into 8 types (empty, refusal, truncated, etc.)

`enforce` runs the full loop. Or drop any primitive into an existing pipeline.

## Invariants

Invariants are schema rules that Zod can't express — cross-field checks, conditional requirements, numeric consistency. Zod validates types, fields, and enums. Invariants validate the relationships between them.

Return `true` if it passes, or a string describing the violation. That string is the exact feedback the model receives on retry.

```typescript
invariants: [
  (data) => data.items.length > 0 || "items must not be empty",
  (data) => data.end > data.start || "end must be after start",
  (data) => allowedRegions.includes(data.region)
    || `region ${data.region} not in allowed list`,
]
```

Each invariant is a function on the parsed data — no external dependencies, no side effects.

You don't design them up front. You discover them from production failures:

1. Ship with the schema.
2. Observe failures via `onAttempt`.
3. Notice a pattern — a field relationship the schema can't enforce.
4. Add one invariant. That structural failure is now caught and repaired automatically.

Each invariant tightens the schema contract. Strictness compounds.

### What each invariant gives you

A single invariant does three things at once:

1. **A runtime guard** — catches the specific violation on every response
2. **A repair directive** — the violation string becomes the exact feedback to the model
3. **A named error class** — tags the failure so you can observe and track it

That third part matters. The moment you add an invariant, you've named a failure mode. It goes from "sometimes the output is wrong" to "`end-before-start` fired 47 times this week." You can count it, track it over time, and measure whether a prompt change or model upgrade actually reduced it.

```typescript
onAttempt: (event) => {
  if (!event.ok) {
    // event.category — "INVARIANT_ERROR", "VALIDATION_ERROR", etc.
    // event.issues — ["end must be after start"]
    // event.number — which attempt
    // event.durationMS — how long it took
  }
}
```

### How invariant repair works

When an invariant fails, the exact violation string becomes the repair message.

```typescript
invariants: [
  (data) => data.end > data.start || "end must be after start",
]
```

**Attempt 1** — the model returns:

```json
{ "start": "2024-03-15", "end": "2024-03-10" }
```

The invariant fires. The model receives:

> Your response had valid types but violated schema constraints:
> - end must be after start
>
> Please correct these issues and respond with valid JSON only.

**Attempt 2** — the model returns:

```json
{ "start": "2024-03-15", "end": "2024-03-20" }
```

Passes. No generic "try again" — the model knew exactly what to fix.

### Works alongside prompt engineering

Invariants don't replace prompt engineering, provider structured output modes, or model upgrades. They work alongside all of them.

The difference: prompt changes are global — fixing one structural issue can destabilize other fields. A model upgrade might fix an issue, or might not. Provider features help, but don't cover cross-field logic.

An invariant is a guaranteed fix for a specific error. If the issue still occurs after a prompt change or model upgrade, the invariant catches it, repairs it automatically, and it never reaches production. If the issue stops occurring, the invariant costs nothing — it doesn't fire.

Because every attempt is logged, you get real signal: which invariants still fire, which went silent after a prompt change, which appeared after a model upgrade. You go from "I think the prompt is better" to knowing exactly what changed.

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
| `INVARIANT_ERROR` | Correct types but failed structural constraints | List the specific constraint violations |
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

Use `llm-contract` when LLM output feeds downstream logic and bad structure has cost:

- Classification and routing
- Extraction (forms, invoices, entities)
- Scoring and normalization
- Moderation and policy labeling
- Any automation step where the output must be valid before it moves forward

Not designed for free-form chat, creative writing, or tasks where structure doesn't matter.

## Install

```bash
npm install llm-contract zod
```

## Further reading

- [API reference](./API.md) — full function signatures and options
- [Examples](./examples) — runnable demos (extraction, moderation, classification, scoring, fallback, primitives)
- [EXAMPLES.md](./EXAMPLES.md) — detailed before/after comparisons

## Status

Preview release.

The core contract loop (schema → validate → targeted repair → retry) is stable.
APIs may evolve as real-world failure patterns are discovered.

This library is intentionally small and opinionated. The goal is correctness at the boundary, not feature breadth.

## License

MIT
