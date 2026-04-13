/**
 * Cheap-first fallback: try a fast model, escalate to a stronger one.
 *
 * The contract boundary is the escalation decision — not heuristics.
 *
 * Simulates:
 *   Cheap model — returns bad enum ("go ahead" instead of "approve"|"reject"|"review")
 *                 twice, exhausting maxAttempts
 *   Strong model — returns compliant output on first attempt
 *
 *   npx tsx examples/fallback.ts
 */
import { defineContract } from "../src/index.js";
import { z } from "zod";

const AnalysisSchema = z.object({
  summary: z.string(),
  risks: z.array(z.string()),
  recommendation: z.enum(["approve", "reject", "review"]),
});

type Analysis = z.infer<typeof AnalysisSchema>;

function simulateCheapModel(_attemptNumber: number): string {
  return JSON.stringify({
    summary: "Looks fine overall",
    risks: [],
    recommendation: "go ahead",
  });
}

function simulateStrongModel(_attemptNumber: number): string {
  return JSON.stringify({
    summary: "Contract review shows standard terms with minor risk areas in auto-renewal and liability",
    risks: [
      "Auto-renewal clause in section 4 — 90-day cancellation window",
      "Liability cap at 2x annual fee — below market rate",
    ],
    recommendation: "review",
  });
}

async function analyzeCheap() {
  console.log("--- Cheap model ---");
  const contract = defineContract({
    schema: AnalysisSchema,
    retry: { maxAttempts: 2 },
    rules: [
      (d: Analysis) =>
        d.risks.length > 0 || d.recommendation === "approve"
          || "non-approve recommendation must cite at least one risk",
    ],
    onAttempt: (event) => {
      const status = event.ok ? "PASS" : `FAIL — ${event.category}`;
      const issues = event.issues.length > 0 ? `\n    ${event.issues.join("\n    ")}` : "";
      console.log(`  Attempt ${event.number}: ${status} (${event.durationMS}ms)${issues}`);
    },
  });
  return contract.accept(async (attempt) => simulateCheapModel(attempt.attempt));
}

async function analyzeStrong() {
  console.log("--- Strong model ---");
  const contract = defineContract({
    schema: AnalysisSchema,
    rules: [
      (d: Analysis) =>
        d.risks.length > 0 || d.recommendation === "approve"
          || "non-approve recommendation must cite at least one risk",
    ],
    onAttempt: (event) => {
      const status = event.ok ? "PASS" : `FAIL — ${event.category}`;
      const issues = event.issues.length > 0 ? `\n    ${event.issues.join("\n    ")}` : "";
      console.log(`  Attempt ${event.number}: ${status} (${event.durationMS}ms)${issues}`);
    },
  });
  return contract.accept(async (attempt) => simulateStrongModel(attempt.attempt));
}

async function main() {
  const cheapResult = await analyzeCheap();

  if (cheapResult.ok) {
    console.log("\nCheap model succeeded:");
    console.log(`  Recommendation: ${cheapResult.data.recommendation}`);
    return;
  }

  console.log("\nCheap model exhausted — escalating to strong model\n");
  const strongResult = await analyzeStrong();

  console.log();
  if (strongResult.ok) {
    console.log(`Recommendation: ${strongResult.data.recommendation}`);
    console.log(`Risks: ${strongResult.data.risks.length}`);
    strongResult.data.risks.forEach((r) => console.log(`  - ${r}`));
    console.log(`Attempts (strong): ${strongResult.attempts}`);
  } else {
    console.error("Both models failed:", strongResult.error.message);
  }
}

main();
