/**
 * Using engine primitives individually.
 *
 * These are the building blocks of the acceptance loop —
 * useful when you want to run parts of the pipeline yourself.
 *
 *   npx tsx examples/primitives.ts
 */
import { clean, classify, verify, repair } from "../src/index.js";
import { z } from "zod";

// --- clean: extract JSON from messy LLM output ---

console.log("=== clean ===");

const fromFences = clean('```json\n{"score": 85}\n```');
console.log("From fences:", fromFences);

const fromProse = clean(
  'Here is the analysis:\n\n{"score": 85}\n\nHope that helps!',
);
console.log("From prose:", fromProse);

const coerced = clean('{"score": "85", "passing": "true"}');
console.log("Coerced:", coerced);

// --- classify: categorize a failure ---

console.log("\n=== classify ===");

console.log("Empty:", classify("", null));
console.log("Refusal:", classify("I'm sorry, I can't help with that.", null));
console.log("No JSON:", classify("The answer is forty-two.", null));

// --- verify: validate against schema + rules ---

console.log("\n=== verify ===");

const Schema = z.object({
  name: z.string(),
  age: z.number().min(0).max(150),
});

const valid = verify({ name: "Alice", age: 30 }, Schema);
console.log("Valid:", valid.ok);

const invalid = verify({ name: "Alice", age: -5 }, Schema);
console.log("Invalid:", invalid.ok);

const withRules = verify({ name: "Alice", age: 10 }, Schema, [
  (d) => d.age >= 18 || "must be 18 or older",
]);
console.log("Rule failed:", !withRules.ok);

// --- repair: turn failures into targeted fix messages ---

console.log("\n=== repair ===");

if (!invalid.ok) {
  const detail = invalid.error.attempts[0];
  const messages = repair(detail);
  if (messages !== false) {
    console.log("Repair message:", messages[0].content);
    console.log("Category:", detail.category);
  }
}
