# API Reference

## `enforce(schema, run, options?)`

The full contract loop. Runs your function, cleans the output, validates against the schema, retries with targeted repair on failure.

```typescript
function enforce<T>(
  schema: ZodType<T>,
  run: (attempt: AttemptContext) => Promise<string | null>,
  options?: EnforceOptions<T>,
): Promise<Result<T>>
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `schema` | `ZodType<T>` | Zod schema defining the expected output shape |
| `run` | `(attempt) => Promise<string \| null>` | Your LLM call. Receives attempt context, returns raw output |
| `options` | `EnforceOptions<T>` | Optional config (see below) |

**AttemptContext** (passed to your `run` function):

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | Auto-generated prompt instructions from the schema |
| `fixes` | `Message[]` | Repair messages from previous failed attempt (empty on first try) |
| `number` | `number` | Current attempt number (1-indexed) |
| `previousError` | `ContractError?` | Error details from the previous attempt |

**EnforceOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Maximum number of attempts |
| `backoff` | `"none" \| "linear" \| "exponential"` | `"none"` | Delay strategy between retries |
| `backoffBaseMS` | `number` | `200` | Base delay in milliseconds |
| `invariants` | `Array<(data: T) => true \| string>` | `[]` | Schema constraints Zod can't express (cross-field checks, conditional rules) |
| `onAttempt` | `(event: AttemptEvent) => void` | — | Hook called after each attempt |
| `repairs` | `Partial<Record<FailureCategory, RepairFn \| false>>` | — | Override or disable repair for specific failure categories |
| `promptSuffix` | `string` | — | Appended to the auto-generated schema prompt. Use for domain-specific instructions without replacing the defaults |

**Result:**

```typescript
type Result<T> = 
  | { ok: true; data: T; attempts: number; raw: string; durationMS: number }
  | { ok: false; error: ContractError }
```

---

## `select(state, schema)`

Strips a state object down to only the fields the schema defines. Prevents sending unnecessary data — PII, secrets, unrelated fields — to the LLM.

```typescript
function select<T>(
  state: Record<string, unknown>,
  schema: ZodType<T>,
): Record<string, unknown>
```

```typescript
select(
  { name: "Alice", email: "a@co.com", ssn: "123-45-6789", passwordHash: "..." },
  z.object({ name: z.string(), email: z.string() }),
);
// { name: "Alice", email: "a@co.com" }
```

---

## `prompt(schema)`

Generates prompt instructions from a Zod schema. Used internally by `enforce` to populate `attempt.prompt`. You can also use it directly if you're building prompts manually.

```typescript
function prompt(schema: ZodType): string
```

---

## `clean(raw)`

Normalizes raw LLM output into clean JSON.

```typescript
function clean(raw: string | null | undefined): unknown
```

Handles:
- Markdown fences (`` ```json ``, `` ```JSON ``, bare `` ``` ``)
- Prose wrapping ("Here is the result: {...} Let me know!")
- Type coercion (`"85"` → `85`, `"true"` → `true`)
- Null/empty input

```typescript
clean('```json\n{"score": 85}\n```');           // { score: 85 }
clean('Here you go: {"score": "85"}');           // { score: 85 }
clean('{"active": "true", "count": "3"}');       // { active: true, count: 3 }
```

---

## `check(data, schema, invariants?)`

Validates data against a Zod schema and optional invariants. Deterministic — no LLM involved.

```typescript
function check<T>(
  data: unknown,
  schema: ZodType<T>,
  invariants?: Invariant<T>[],
): Result<T>
```

```typescript
check({ name: "Alice", age: 30 }, Schema);
// { ok: true, data: { name: "Alice", age: 30 } }

check({ name: "Alice", age: -5 }, Schema);
// { ok: false, error: { attempts: [{ issues: ["age: Number must be greater than or equal to 0"] }] } }
```

---

## `fix(detail, repairs?)`

Turns validation failures into targeted repair messages for the next attempt.

```typescript
function fix(detail: AttemptDetail, repairs?: Partial<Record<FailureCategory, RepairFn | false>>): Message[] | false
```

```typescript
fix(checkResult.error);
// [{ role: "user", content: "Your previous response had validation errors:\n- age: ..." }]
```

---

## `classify(raw, cleaned)`

Categorizes a failed LLM response into a `FailureCategory`:

```typescript
type FailureCategory =
  | "EMPTY_RESPONSE"
  | "REFUSAL"
  | "NO_JSON"
  | "TRUNCATED"
  | "PARSE_ERROR"
  | "VALIDATION_ERROR"
  | "INVARIANT_ERROR"
  | "RUN_ERROR"
```

Used internally by `enforce`. Available if you're building custom pipelines.
