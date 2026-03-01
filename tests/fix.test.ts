import { describe, it, expect } from "vitest";
import { fix } from "../src/fix.js";
import type { AttemptDetail, Message } from "../src/types.js";

function asMessages(result: Message[] | false): Message[] {
  if (result === false) {
    throw new Error("Expected messages, got false");
  }
  return result;
}

describe("fix", () => {
  it("generates a repair for VALIDATION_ERROR with specific issues", () => {
    const detail: AttemptDetail = {
      raw: "{}",
      cleaned: {},
      issues: ["age: Required"],
      category: "VALIDATION_ERROR",
    };

    const messages = asMessages(fix(detail));
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("age: Required");
    expect(messages[0].content).toContain("validation errors");
  });

  it("generates a repair for EMPTY_RESPONSE", () => {
    const detail: AttemptDetail = {
      raw: "",
      cleaned: null,
      issues: ["Response was empty"],
      category: "EMPTY_RESPONSE",
    };

    const messages = asMessages(fix(detail));
    expect(messages[0].content).toContain("empty response");
  });

  it("generates a repair for REFUSAL", () => {
    const detail: AttemptDetail = {
      raw: "I'm sorry, I can't help.",
      cleaned: null,
      issues: ["Model refused"],
      category: "REFUSAL",
    };

    const messages = asMessages(fix(detail));
    expect(messages[0].content).toContain("structured data task");
  });

  it("generates a repair for NO_JSON", () => {
    const detail: AttemptDetail = {
      raw: "The answer is positive.",
      cleaned: null,
      issues: ["No JSON"],
      category: "NO_JSON",
    };

    const messages = asMessages(fix(detail));
    expect(messages[0].content).toContain("no JSON");
  });

  it("generates a repair for TRUNCATED", () => {
    const detail: AttemptDetail = {
      raw: '{"name": "Alice',
      cleaned: null,
      issues: ["Truncated"],
      category: "TRUNCATED",
    };

    const messages = asMessages(fix(detail));
    expect(messages[0].content).toContain("cut off");
  });

  it("generates a repair for PARSE_ERROR", () => {
    const detail: AttemptDetail = {
      raw: '{"name": "Alice",}',
      cleaned: null,
      issues: ["Parse error"],
      category: "PARSE_ERROR",
    };

    const messages = asMessages(fix(detail));
    expect(messages[0].content).toContain("malformed JSON");
  });

  it("generates a repair for INVARIANT_ERROR", () => {
    const detail: AttemptDetail = {
      raw: '{"total": 90}',
      cleaned: { total: 90 },
      issues: ["total must be >= subtotal"],
      category: "INVARIANT_ERROR",
    };

    const messages = asMessages(fix(detail));
    expect(messages[0].content).toContain("schema constraints");
    expect(messages[0].content).toContain("total must be >= subtotal");
  });

  it("generates a repair for RUN_ERROR", () => {
    const detail: AttemptDetail = {
      raw: "",
      cleaned: null,
      issues: ["run function threw: Network timeout"],
      category: "RUN_ERROR",
    };

    const messages = asMessages(fix(detail));
    expect(messages[0].content).toContain("error");
  });

  describe("user overrides", () => {
    it("uses custom repair when provided", () => {
      const detail: AttemptDetail = {
        raw: "I'm sorry",
        cleaned: null,
        issues: ["Refused"],
        category: "REFUSAL",
      };

      const messages = asMessages(
        fix(detail, {
          REFUSAL: () => [
            { role: "user", content: "Custom refusal handler" },
          ],
        }),
      );
      expect(messages[0].content).toBe("Custom refusal handler");
    });

    it("returns false when override is false (stop retry)", () => {
      const detail: AttemptDetail = {
        raw: "I'm sorry",
        cleaned: null,
        issues: ["Refused"],
        category: "REFUSAL",
      };

      const result = fix(detail, { REFUSAL: false });
      expect(result).toBe(false);
    });

    it("falls through to default when category not overridden", () => {
      const detail: AttemptDetail = {
        raw: "",
        cleaned: null,
        issues: ["Empty"],
        category: "EMPTY_RESPONSE",
      };

      const messages = asMessages(
        fix(detail, {
          REFUSAL: false,
        }),
      );
      expect(messages[0].content).toContain("empty response");
    });
  });
});
