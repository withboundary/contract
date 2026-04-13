/**
 * Invoice extraction with cross-field math rules.
 *
 * Simulates realistic LLM failures:
 *   Attempt 1 — markdown fences + string-typed numbers (cleaned automatically)
 *              but line items don't sum to subtotal
 *   Attempt 2 — model fixes subtotal after invariant feedback
 *              but subtotal + tax != total
 *   Attempt 3 — model gets everything right
 *
 *   npx tsx examples/extraction.ts
 */
import { defineContract } from "../src/index.js";
import { z } from "zod";

const InvoiceSchema = z.object({
  vendor: z.string(),
  invoiceNumber: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      amount: z.number(),
    }),
  ),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
});

type Invoice = z.infer<typeof InvoiceSchema>;

function simulateLLM(attemptNumber: number): string {
  if (attemptNumber === 1) {
    return [
      "```json",
      JSON.stringify({
        vendor: "Acme Corp",
        invoiceNumber: "INV-2024-001",
        date: "2024-03-15",
        lineItems: [
          { description: "Widget A", quantity: "2", unitPrice: "50", amount: "100" },
          { description: "Widget B", quantity: "1", unitPrice: "250", amount: "250" },
        ],
        subtotal: "400",
        tax: "35",
        total: "385",
      }),
      "```",
    ].join("\n");
  }

  if (attemptNumber === 2) {
    return JSON.stringify({
      vendor: "Acme Corp",
      invoiceNumber: "INV-2024-001",
      date: "2024-03-15",
      lineItems: [
        { description: "Widget A", quantity: 2, unitPrice: 50, amount: 100 },
        { description: "Widget B", quantity: 1, unitPrice: 250, amount: 250 },
      ],
      subtotal: 350,
      tax: 35,
      total: 400,
    });
  }

  return JSON.stringify({
    vendor: "Acme Corp",
    invoiceNumber: "INV-2024-001",
    date: "2024-03-15",
    lineItems: [
      { description: "Widget A", quantity: 2, unitPrice: 50, amount: 100 },
      { description: "Widget B", quantity: 1, unitPrice: 250, amount: 250 },
    ],
    subtotal: 350,
    tax: 35,
    total: 385,
  });
}

async function main() {
  const contract = defineContract({
    schema: InvoiceSchema,
    rules: [
      (d: Invoice) => d.lineItems.length > 0 || "invoice must have at least one line item",
      (d: Invoice) => {
        const sum = d.lineItems.reduce((s, i) => s + i.amount, 0);
        return Math.abs(sum - d.subtotal) < 0.01
          || `line items sum to ${sum}, but subtotal is ${d.subtotal}`;
      },
      (d: Invoice) =>
        Math.abs(d.subtotal + d.tax - d.total) < 0.01
          || `subtotal (${d.subtotal}) + tax (${d.tax}) = ${d.subtotal + d.tax}, but total is ${d.total}`,
      (d: Invoice) => {
        const bad = d.lineItems.find(i => Math.abs(i.quantity * i.unitPrice - i.amount) >= 0.01);
        return !bad
          || `${bad.description}: quantity (${bad.quantity}) * unitPrice (${bad.unitPrice}) = ${bad.quantity * bad.unitPrice}, but amount is ${bad.amount}`;
      },
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
    console.log(`Vendor: ${result.data.vendor}`);
    console.log(`Invoice: ${result.data.invoiceNumber}`);
    console.log(`Line items: ${result.data.lineItems.length}`);
    console.log(`Total: $${result.data.total.toFixed(2)}`);
    console.log(`Attempts: ${result.attempts}`);
  } else {
    console.error("Failed:", result.error.message);
  }
}

main();
