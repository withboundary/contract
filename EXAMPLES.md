# llm-contract — Before & After

## What this library does

You define a schema. You call your LLM however you want. The library cleans, validates, and retries until you get typed data back — or a clear error.

---

## Example 1: Sentiment Analysis

### Before

```typescript
async function analyzeSentiment(text: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Analyze the sentiment of the text. Return JSON with: sentiment (positive/negative/neutral), confidence (number 0-1). Return ONLY JSON.",
      },
      { role: "user", content: text },
    ],
  });

  const raw = response.choices[0].message.content ?? "";

  // Strip markdown fences (hope this covers all cases)
  let cleaned = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  // Parse JSON (hope it's valid)
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw}`);
  }

  // Validate fields (hope we didn't miss any)
  if (!["positive", "negative", "neutral"].includes(parsed.sentiment)) {
    throw new Error(`Invalid sentiment: ${parsed.sentiment}`);
  }
  if (
    typeof parsed.confidence !== "number" ||
    parsed.confidence < 0 ||
    parsed.confidence > 1
  ) {
    throw new Error(`Invalid confidence: ${parsed.confidence}`);
  }

  // Cast and pray
  return parsed as {
    sentiment: "positive" | "negative" | "neutral";
    confidence: number;
  };
}
```

**Problems:**

- Prompt instructions are hand-written and can drift from validation
- Markdown stripping is fragile (misses `` ```JSON ``, ` ```\n\n `, prose wrapping)
- No retry — one bad response and it throws
- `as` cast gives fake type safety — nothing enforces the shape at runtime
- No repair — the model never learns what it did wrong
- Every LLM call in the codebase has its own version of this mess

### After

```typescript
import { enforce } from "llm-contract";
import { z } from "zod";

const Sentiment = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
});

async function analyzeSentiment(text: string) {
  return enforce(Sentiment, async (attempt) => {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: attempt.prompt },
        { role: "user", content: text },
        ...attempt.fixes,
      ],
    });
    return res.choices[0].message.content;
  });
}
```

**What changed:**

- Schema is the single source of truth for types AND validation AND prompt
- `attempt.prompt` is auto-generated from the Zod schema — always in sync
- `clean` runs automatically — handles fences, prose, type coercion
- If validation fails, `attempt.fixes` contains a repair message on retry
- Return type is `Result<{ sentiment: ..., confidence: ... }>` — real types, no cast
- 3 retries by default, zero config

---

## Example 2: Invoice Extraction with Cross-Field Invariants

### Before

```typescript
async function extractInvoice(pdfText: string) {
  let lastError: string | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    const messages: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content: `Extract these fields from the invoice as JSON:
- vendor (string, required)
- invoiceNumber (string, required)
- date (string in YYYY-MM-DD format)
- lineItems (array of objects with: description string, quantity number, unitPrice number, amount number)
- subtotal (number)
- tax (number)
- total (number)
Return ONLY valid JSON, no other text.`,
      },
      { role: "user", content: pdfText },
    ];

    if (attempt > 0 && lastError) {
      messages.push({
        role: "user",
        content: `Previous response was invalid: ${lastError}. Please fix and try again.`,
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages as any,
    });

    const raw = response.choices[0].message.content ?? "";
    let parsed: any;
    try {
      parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch {
      lastError = "Response was not valid JSON";
      continue;
    }

    if (typeof parsed.total !== "number") {
      lastError = "total must be a number";
      continue;
    }

    return parsed;
  }

  throw new Error(`Failed to extract invoice after 3 attempts: ${lastError}`);
}
```

**Problems:**

- 50+ lines for one extraction
- Prompt describes the schema in English — can drift from validation
- No cross-field validation (line items could sum to anything)
- Repair message is vague — doesn't tell the model which field or constraint
- `any` types, no runtime enforcement, `"250"` as string causes unnecessary failure

### After

```typescript
import { enforce } from "llm-contract";
import { z } from "zod";

const Invoice = z.object({
  vendor: z.string(),
  invoiceNumber: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      amount: z.number(),
    })
  ),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
});

async function extractInvoice(pdfText: string) {
  return enforce(Invoice, async (attempt) => {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: attempt.prompt },
        { role: "user", content: pdfText },
        ...attempt.fixes,
      ],
    });
    return res.choices[0].message.content;
  }, {
    invariants: [
      (d) => {
        const sum = d.lineItems.reduce((s, i) => s + i.amount, 0);
        return Math.abs(sum - d.subtotal) < 0.01
          || `line items sum to ${sum}, but subtotal is ${d.subtotal}`;
      },
      (d) => Math.abs(d.subtotal + d.tax - d.total) < 0.01
        || `subtotal (${d.subtotal}) + tax (${d.tax}) = ${d.subtotal + d.tax}, but total is ${d.total}`,
    ],
  });
}
```

**What changed:**

- Schema validates every field — date format, nested array items, all number fields
- Invariants enforce cross-field math: line items must sum to subtotal, subtotal + tax must equal total
- `clean` coerces `"250.00"` → `250` automatically — no wasted retry
- `fix` generates specific messages: `line items sum to 400, but subtotal is 350`
- Return type is fully inferred from the Zod schema
- See [`examples/extraction.ts`](./examples/extraction.ts) for a runnable simulation

---

## Example 3: Classification with structural constraints

### Before

```typescript
async function classifyTicket(
  ticket: string
): Promise<{ category: string; priority: string; tags: string[] }> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Classify this support ticket as JSON:
- category: one of "bug", "feature", "question", "billing"
- priority: one of "low", "medium", "high", "critical"
- tags: array of relevant tags (max 5)
JSON only.`,
      },
      { role: "user", content: ticket },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  // Some validation... but not all
  if (!["bug", "feature", "question", "billing"].includes(parsed.category)) {
    throw new Error(`Invalid category: ${parsed.category}`);
  }

  // Forgot to validate priority
  // Forgot to validate tags length

  return parsed;
}
```

**Problems:**

- Priority validation is missing entirely — `"urgent"` would pass through
- Tags array length isn't checked — model could return 20 tags
- Return type is `{ category: string }` — not `"bug" | "feature" | ...`
- No retry, no repair

### After

```typescript
import { enforce } from "llm-contract";
import { z } from "zod";

const Ticket = z.object({
  category: z.enum(["bug", "feature", "question", "billing"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  tags: z.array(z.string()).max(5),
});

async function classifyTicket(ticket: string) {
  return enforce(Ticket, async (attempt) => {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: attempt.prompt },
        { role: "user", content: ticket },
        ...attempt.fixes,
      ],
    });
    return res.choices[0].message.content;
  });
}
```

---

## Example 4: Using primitives individually

You don't have to use `enforce`. Each primitive works on its own.

### `clean` — extract JSON from messy LLM output

```typescript
import { clean } from "llm-contract";

// Markdown fences
clean('```json\n{"score": 85}\n```');
// → { score: 85 }

// Prose wrapping
clean('Here is the analysis:\n\n{"score": 85}\n\nLet me know if you need more.');
// → { score: 85 }

// Type coercion
clean('{"score": "85", "passing": "true"}');
// → { score: 85, passing: true }

// Nested fences with language variations
clean('```JSON\n{"score": 85}\n```');
// → { score: 85 }
```

### `check` — validate data against a schema

```typescript
import { check } from "llm-contract";
import { z } from "zod";

const Schema = z.object({
  name: z.string(),
  age: z.number().min(0).max(150),
});

check({ name: "Alice", age: 30 }, Schema);
// → { ok: true, data: { name: "Alice", age: 30 } }

check({ name: "Alice", age: -5 }, Schema);
// → { ok: false, error: { issues: ["age: must be >= 0 (received -5)"] } }

check({ name: 123 }, Schema);
// → { ok: false, error: { issues: ["name: expected string, got number", "age: required"] } }
```

### `fix` — turn validation errors into repair prompts

```typescript
import { fix } from "llm-contract";

const error = {
  issues: [
    "age: must be >= 0 (received -5)",
    "email: expected string, got undefined",
  ],
};

fix(error);
// → [{
//   role: "user",
//   content: "Your previous response had validation errors:\n"
//     + "- age: must be >= 0 (received -5)\n"
//     + "- email: expected string, got undefined\n"
//     + "Please correct these issues and respond with valid JSON."
// }]
```

### `select` — project state down to schema shape

```typescript
import { select } from "llm-contract";
import { z } from "zod";

const fullUser = {
  id: "u_123",
  name: "Alice Chen",
  email: "alice@company.com",
  passwordHash: "$2b$10$abc...",
  ssn: "123-45-6789",
  loginHistory: [{ ts: "2024-01-01", ip: "10.0.0.1" }],
  preferences: { theme: "dark" },
};

const ReviewSchema = z.object({
  name: z.string(),
  email: z.string(),
});

select(fullUser, ReviewSchema);
// → { name: "Alice Chen", email: "alice@company.com" }
//
// passwordHash: gone
// ssn: gone
// loginHistory: gone
// preferences: gone
// The LLM never sees them.
```

---

## Example 5: Handling results

`enforce` never throws. It returns a `Result` — either the data or a structured error.

```typescript
const result = await enforce(Schema, runFn);

// Option A: Check and branch
if (result.ok) {
  console.log(result.data);     // fully typed from schema
  console.log(result.attempts);  // how many attempts it took
} else {
  console.log(result.error.message);   // human-readable summary
  console.log(result.error.attempts);  // every attempt's details:
  // [
  //   { raw: "```json\n{...}\n```", cleaned: {...}, issues: [...] },
  //   { raw: "{...}", cleaned: {...}, issues: [...] },
  //   { raw: "{...}", cleaned: {...}, issues: [...] },
  // ]
}

// Option B: Unwrap (throws on failure, for scripts/CLIs)
const data = result.unwrap();
```

---

## Example 6: Custom options

```typescript
const result = await enforce(
  InvoiceSchema,
  async (attempt) => {
    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        { role: "user", content: `${attempt.prompt}\n\n${pdfText}` },
        ...attempt.fixes,
      ],
    });
    return res.content[0].text;
  },
  {
    maxAttempts: 5,
    backoff: "exponential",
    invariants: [
      (inv) => inv.total >= inv.subtotal || "total must be >= subtotal",
      (inv) => inv.lineItems.length > 0 || "must have at least one line item",
    ],
    onAttempt: (event) => {
      console.log(`Attempt ${event.number}: ${event.ok ? "pass" : "fail"}`);
    },
  }
);
```

**What's happening:**

- Using Anthropic instead of OpenAI — `enforce` doesn't care, you own the call
- 5 attempts instead of the default 3
- Exponential backoff between retries
- Custom invariants for structural constraints Zod can't express
- Hook to observe each attempt

---

## Runnable examples

All examples in `examples/` simulate realistic LLM failures and show the full contract loop:

| File | Domain | What it demonstrates |
|------|--------|---------------------|
| [`extraction.ts`](./examples/extraction.ts) | Invoice extraction | Cross-field math invariants, markdown fence cleaning, string-to-number coercion |
| [`moderation.ts`](./examples/moderation.ts) | Content moderation | Policy consistency invariants (can't block with low confidence) |
| [`classification.ts`](./examples/classification.ts) | Support ticket routing | Invariant-driven repair (empty tags, summary length) |
| [`scoring.ts`](./examples/scoring.ts) | Lead scoring | Tier/score alignment invariants, truncated JSON recovery |
| [`fallback.ts`](./examples/fallback.ts) | Contract review | Cheap-first fallback — contract boundary as escalation decision |
| [`primitives.ts`](./examples/primitives.ts) | Individual functions | Using `clean`, `check`, `fix`, `select`, `prompt` standalone |

Run any example:

```bash
npx tsx examples/extraction.ts
```

---

## The pattern

Every example follows the same structure:

```
1. Define the schema         →  Zod object, one place, one truth
2. Call enforce               →  Pass schema + your LLM call
3. Use attempt.prompt         →  Schema-generated instructions
4. Use attempt.fixes          →  Repair messages on retry
5. Return raw LLM output      →  Library handles the rest
6. Check result.ok            →  Typed data or structured error
```

The library owns the contract. You own the call.
