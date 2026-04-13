/**
 * Lead scoring with tier/score alignment rules.
 *
 * Simulates realistic LLM failures:
 *   Attempt 1 — truncated JSON (cut off mid-response)
 *   Attempt 2 — complete JSON but tier "hot" with score 25 (mismatch)
 *   Attempt 3 — model aligns tier to score after invariant feedback
 *
 *   npx tsx examples/scoring.ts
 */
import { defineContract } from "../src/index.js";
import { z } from "zod";

const LeadSchema = z.object({
  company: z.string(),
  score: z.number().int().min(0).max(100),
  tier: z.enum(["hot", "warm", "cold"]),
  qualified: z.boolean(),
  signals: z.array(z.string()),
  nextAction: z.enum(["schedule_call", "send_materials", "nurture", "close"]),
});

type Lead = z.infer<typeof LeadSchema>;

function simulateLLM(attemptNumber: number): string {
  if (attemptNumber === 1) {
    return `{"company":"TechVentures Inc","score":25,"tier":"hot","qualified":true,"signals":["visited pricing page","downloaded whitepaper","att`;
  }

  if (attemptNumber === 2) {
    return JSON.stringify({
      company: "TechVentures Inc",
      score: 25,
      tier: "hot",
      qualified: true,
      signals: ["visited pricing page", "downloaded whitepaper", "attended webinar"],
      nextAction: "close",
    });
  }

  return JSON.stringify({
    company: "TechVentures Inc",
    score: 25,
    tier: "cold",
    qualified: false,
    signals: ["visited pricing page", "downloaded whitepaper", "attended webinar"],
    nextAction: "nurture",
  });
}

async function main() {
  const contract = defineContract({
    schema: LeadSchema,
    rules: [
      (d: Lead) =>
        d.tier !== "hot" || d.score >= 70
          || `tier is "hot" but score is ${d.score} (minimum 70 for hot)`,
      (d: Lead) =>
        d.tier !== "cold" || d.score < 30
          || `tier is "cold" but score is ${d.score} (must be under 30 for cold)`,
      (d: Lead) =>
        d.nextAction !== "close" || d.qualified
          || 'nextAction is "close" but lead is not qualified',
      (d: Lead) =>
        d.signals.length > 0 || "must cite at least one signal",
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
    console.log(`Company: ${result.data.company}`);
    console.log(`Score: ${result.data.score} (${result.data.tier})`);
    console.log(`Qualified: ${result.data.qualified}`);
    console.log(`Signals: ${result.data.signals.join(", ")}`);
    console.log(`Next action: ${result.data.nextAction}`);
    console.log(`Attempts: ${result.attempts}`);
  } else {
    console.error("Failed:", result.error.message);
  }
}

main();
