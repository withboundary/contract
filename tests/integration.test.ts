import { describe, it, expect } from "vitest";
import { z } from "zod";
import { clean, enforce, repair, verify } from "../src/index.js";
import { select } from "../src/utils/select.js";
import type { ContractAttempt, Message } from "../src/index.js";

function asMessages(result: Message[] | false): Message[] {
  if (result === false) {
    throw new Error("Expected messages, got false");
  }
  return result;
}

describe("integration: full pipeline", () => {
  it("extracts invoice from fenced, prose-wrapped response", async () => {
    const InvoiceSchema = z.object({
      vendorName: z.string(),
      invoiceNumber: z.string(),
      total: z.number(),
      lineItems: z.array(
        z.object({
          description: z.string(),
          amount: z.number(),
        }),
      ),
    });

    const result = await enforce(InvoiceSchema, async () => {
      return `
Here is the extracted data:

\`\`\`json
{
  "vendorName": "Acme Corp",
  "invoiceNumber": "INV-001",
  "total": 1500,
  "lineItems": [
    {"description": "Widget A", "amount": 500},
    {"description": "Widget B", "amount": 1000}
  ]
}
\`\`\`

Let me know if you need anything else!`;
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.vendorName).toBe("Acme Corp");
      expect(result.data.lineItems).toHaveLength(2);
      expect(result.data.total).toBe(1500);
    }
  });

  it("handles coercion and repair across attempts", async () => {
    const ScoreSchema = z.object({
      score: z.number().min(0).max(100),
      grade: z.enum(["A", "B", "C", "D", "F"]),
    });

    let attemptNum = 0;
    const result = await enforce(ScoreSchema, async (attempt: ContractAttempt) => {
      attemptNum++;
      if (attemptNum === 1) {
        return '{"score": "85", "grade": "excellent"}';
      }
      return '{"score": "85", "grade": "A"}';
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.score).toBe(85);
      expect(result.data.grade).toBe("A");
      expect(result.attempts).toBe(2);
    }
  });

  it("applies rules after schema validation", async () => {
    const OrderSchema = z.object({
      subtotal: z.number(),
      tax: z.number(),
      total: z.number(),
    });

    const result = await enforce(
      OrderSchema,
      async () => {
        return '{"subtotal": 100, "tax": 10, "total": 90}';
      },
      {
        retry: { maxAttempts: 1 },
        rules: [
          (o) =>
            Math.abs(o.total - (o.subtotal + o.tax)) < 0.01 ||
            `total ${o.total} != subtotal ${o.subtotal} + tax ${o.tax}`,
        ],
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts[0].issues[0]).toContain("total 90");
      expect(result.error.attempts[0].category).toBe("INVARIANT_ERROR");
    }
  });
});

describe("integration: primitives used individually", () => {
  it("clean + verify pipeline", () => {
    const Schema = z.object({
      name: z.string(),
      score: z.number(),
    });

    const raw = '```json\n{"name": "Alice", "score": "95"}\n```';
    const cleaned = clean(raw);
    const result = verify(cleaned, Schema);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Alice");
      expect(result.data.score).toBe(95);
    }
  });

  it("verify + repair pipeline", () => {
    const Schema = z.object({
      category: z.enum(["bug", "feature", "question"]),
    });

    const result = verify({ category: "request" }, Schema);
    expect(result.ok).toBe(false);

    if (!result.ok) {
      const lastDetail = result.error.attempts[0];
      const messages = asMessages(repair(lastDetail));
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toContain("category");
    }
  });

  it("select drops sensitive fields before LLM call", () => {
    const employee = {
      id: "emp_001",
      name: "Alice",
      ssn: "123-45-6789",
      salary: 95000,
      department: "Engineering",
    };

    const Schema = z.object({
      name: z.string(),
      department: z.string(),
    });

    const safe = select(employee, Schema);
    expect(safe).toEqual({ name: "Alice", department: "Engineering" });
    expect(safe).not.toHaveProperty("ssn");
    expect(safe).not.toHaveProperty("salary");
    expect(safe).not.toHaveProperty("id");
  });
});

describe("integration: multi-step chain", () => {
  it("output of first enforce feeds into second", async () => {
    const PlanSchema = z.object({
      steps: z.array(z.string()),
    });

    const SummarySchema = z.object({
      summary: z.string(),
      stepCount: z.number(),
    });

    const planResult = await enforce(PlanSchema, async () => {
      return '{"steps": ["analyze", "implement", "test"]}';
    });

    expect(planResult.ok).toBe(true);
    if (!planResult.ok) { return; }

    const summaryResult = await enforce(SummarySchema, async () => {
      const stepCount = planResult.data.steps.length;
      return JSON.stringify({
        summary: `Plan has ${stepCount} steps`,
        stepCount,
      });
    });

    expect(summaryResult.ok).toBe(true);
    if (summaryResult.ok) {
      expect(summaryResult.data.stepCount).toBe(3);
      expect(summaryResult.data.summary).toContain("3 steps");
    }
  });
});

describe("integration: error classification end-to-end", () => {
  it("refusal is classified and can be stopped via repairs override", async () => {
    let attempts = 0;
    const result = await enforce(
      z.object({ answer: z.string() }),
      async () => {
        attempts++;
        return "I'm sorry, I cannot assist with that request.";
      },
      {
        retry: { maxAttempts: 5 },
        repairs: { REFUSAL: false },
      },
    );

    expect(attempts).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts[0].category).toBe("REFUSAL");
    }
  });

  it("truncated response gets appropriate repair and retries", async () => {
    let attempts = 0;
    const result = await enforce(
      z.object({ name: z.string(), age: z.number() }),
      async (attempt) => {
        attempts++;
        if (attempts === 1) {
          return '{"name": "Alice", "age":';
        }
        return '{"name": "Alice", "age": 30}';
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Alice");
      expect(result.attempts).toBe(2);
    }
  });

  it("custom repair override is used for specific category", async () => {
    let receivedFix = "";
    const result = await enforce(
      z.object({ data: z.string() }),
      async (attempt) => {
        if (attempt.repairs.length > 0) {
          receivedFix = attempt.repairs[0].content;
        }
        if (attempt.attempt === 1) {
          return "The data looks good, no issues found.";
        }
        return '{"data": "extracted"}';
      },
      {
        repairs: {
          NO_JSON: () => [
            { role: "user", content: "DOMAIN: respond as JSON extraction" },
          ],
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(receivedFix).toBe("DOMAIN: respond as JSON extraction");
  });
});
