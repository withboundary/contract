/**
 * Content moderation with policy consistency rules.
 *
 * Rules enforce that moderation decisions are internally consistent:
 *   - blocking requires high confidence
 *   - non-allow needs a reason and category
 *   - allow with categories is contradictory
 *
 * Simulates realistic LLM failures:
 *   Attempt 1 — prose-wrapped JSON ("Here is my analysis: {...}")
 *              clean extracts it, but action is "block" with confidence 0.3
 *   Attempt 2 — model raises confidence but leaves categories empty on a block
 *   Attempt 3 — model returns consistent policy decision
 *
 *   npx tsx examples/moderation.ts
 */
import { defineContract } from "../src/index.js";
import { z } from "zod";

const ModerationSchema = z.object({
  action: z.enum(["allow", "flag", "block"]),
  reason: z.string(),
  categories: z.array(z.enum(["spam", "harassment", "nsfw", "pii", "off-topic"])),
  confidence: z.number().min(0).max(1),
});

type Moderation = z.infer<typeof ModerationSchema>;

function simulateLLM(attemptNumber: number): string {
  if (attemptNumber === 1) {
    return `Here is my analysis of the content:

${JSON.stringify({
  action: "block",
  reason: "Potentially harmful",
  categories: ["harassment"],
  confidence: 0.3,
})}

Let me know if you need anything else!`;
  }

  if (attemptNumber === 2) {
    return JSON.stringify({
      action: "block",
      reason: "",
      categories: [],
      confidence: 0.85,
    });
  }

  return JSON.stringify({
    action: "flag",
    reason: "Contains language that may violate community guidelines — needs human review",
    categories: ["harassment"],
    confidence: 0.72,
  });
}

async function main() {
  const contract = defineContract({
    name: "content-moderation",
    schema: ModerationSchema,
    rules: [
      // blocking requires high confidence — prevent false positives
      (decision: Moderation) =>
        decision.confidence >= 0.7 || decision.action !== "block"
          || `cannot block with confidence ${decision.confidence} (minimum 0.7)`,

      // if you're flagging or blocking, explain why
      (decision: Moderation) =>
        decision.action === "allow" || decision.reason.length > 10
          || "blocked or flagged content must have a meaningful reason",

      // non-allow decisions must cite at least one policy category
      (decision: Moderation) =>
        decision.action === "allow" || decision.categories.length > 0
          || "non-allow decisions must specify at least one category",

      // allow + categories is contradictory
      (decision: Moderation) =>
        decision.action !== "allow" || decision.categories.length === 0
          || "action is allow but categories are non-empty — contradictory",
    ],
    onAttempt: (event) => {
      const status = event.ok ? "PASS" : `FAIL — ${event.category}`;
      const issues = event.issues.length > 0 ? `\n    ${event.issues.join("\n    ")}` : "";
      console.log(`  Attempt ${event.number}: ${status} (${event.durationMS}ms)${issues}`);
    },
  });

  const result = await contract.accept(async (attempt) => simulateLLM(attempt.attempt));

  console.log();
  if (result.ok) {
    console.log(`Action: ${result.data.action}`);
    console.log(`Reason: ${result.data.reason}`);
    console.log(`Categories: ${result.data.categories.join(", ")}`);
    console.log(`Confidence: ${result.data.confidence}`);
    console.log(`Attempts: ${result.attempts}`);
  } else {
    console.error("Failed:", result.error.message);
  }
}

main();
