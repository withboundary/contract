/**
 * Support ticket classification with realistic failure simulation.
 *
 * Simulates realistic LLM failures:
 *   Attempt 1 — valid JSON but empty tags array
 *   Attempt 2 — model adds tags after rule feedback, but summary is 250+ chars
 *   Attempt 3 — model returns compliant output
 *
 *   npx tsx examples/classification.ts
 */
import { defineContract } from "../src/index.js";
import { z } from "zod";

const TicketSchema = z.object({
  category: z.enum(["bug", "feature", "question", "billing"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  tags: z.array(z.string()).max(5),
  summary: z.string(),
});

type Ticket = z.infer<typeof TicketSchema>;

function simulateLLM(attemptNumber: number): string {
  if (attemptNumber === 1) {
    return JSON.stringify({
      category: "billing",
      priority: "high",
      tags: [],
      summary: "Customer was charged twice for the Pro plan and is requesting a refund.",
    });
  }

  if (attemptNumber === 2) {
    return JSON.stringify({
      category: "billing",
      priority: "high",
      tags: ["billing", "refund", "duplicate-charge"],
      summary:
        "The customer reports that their credit card was charged twice for the Pro plan subscription last month. " +
        "They are requesting a full refund for the duplicate charge. The customer has been a subscriber for 18 months " +
        "and has not had previous billing issues. This is a high-priority item due to potential chargeback risk.",
    });
  }

  return JSON.stringify({
    category: "billing",
    priority: "high",
    tags: ["billing", "refund", "duplicate-charge"],
    summary: "Duplicate Pro plan charge — customer requesting refund for second payment",
  });
}

async function main() {
  const contract = defineContract({
    name: "support-ticket-classification",
    schema: TicketSchema,
    debug: true,
    rules: [
      // every ticket needs at least one tag for routing
      (ticket: Ticket) =>
        ticket.tags.length > 0 || "must have at least one tag",

      // summaries must be concise enough for the queue view
      (ticket: Ticket) =>
        ticket.summary.length <= 200
          || `summary too long: ${ticket.summary.length} chars (max 200)`,
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
    console.log(`Category: ${result.data.category}`);
    console.log(`Priority: ${result.data.priority}`);
    console.log(`Tags: ${result.data.tags.join(", ")}`);
    console.log(`Summary: ${result.data.summary}`);
    console.log(`Attempts: ${result.attempts}`);
  } else {
    console.error("Failed:", result.error.message);
  }
}

main();
