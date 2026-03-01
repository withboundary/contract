import { describe, it, expect } from "vitest";
import { z } from "zod";
import { enforce } from "../src/enforce.js";
import type { AttemptContext, AttemptEvent } from "../src/types.js";

const Schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
});

describe("enforce", () => {
  it("succeeds on first attempt with valid JSON", async () => {
    const result = await enforce(Schema, async () => {
      return '{"sentiment": "positive", "confidence": 0.95}';
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sentiment).toBe("positive");
      expect(result.data.confidence).toBe(0.95);
      expect(result.attempts).toBe(1);
      expect(result.raw).toContain("positive");
      expect(result.durationMS).toBeGreaterThanOrEqual(0);
    }
  });

  it("succeeds on first attempt with fenced JSON", async () => {
    const result = await enforce(Schema, async () => {
      return '```json\n{"sentiment": "negative", "confidence": 0.8}\n```';
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sentiment).toBe("negative");
    }
  });

  it("repairs and succeeds on retry", async () => {
    let callCount = 0;
    const result = await enforce(Schema, async (attempt: AttemptContext) => {
      callCount++;
      if (callCount === 1) {
        return '{"sentiment": "great", "confidence": 0.9}';
      }
      expect(attempt.fixes.length).toBeGreaterThan(0);
      expect(attempt.previousCategory).toBe("VALIDATION_ERROR");
      return '{"sentiment": "positive", "confidence": 0.9}';
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sentiment).toBe("positive");
      expect(result.attempts).toBe(2);
    }
  });

  it("fails after max attempts", async () => {
    const result = await enforce(
      Schema,
      async () => {
        return '{"sentiment": "invalid", "confidence": 2.0}';
      },
      { maxAttempts: 2 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts).toHaveLength(2);
      expect(result.error.attempts[0].category).toBe("VALIDATION_ERROR");
      expect(result.error.message).toContain("2 attempt");
    }
  });

  it("handles run function throwing with RUN_ERROR category", async () => {
    let callCount = 0;
    const result = await enforce(
      Schema,
      async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Network timeout");
        }
        return '{"sentiment": "neutral", "confidence": 0.5}';
      },
      { maxAttempts: 3 },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(2);
    }
  });

  it("returns failure when run always throws", async () => {
    const result = await enforce(
      Schema,
      async () => {
        throw new Error("API down");
      },
      { maxAttempts: 2 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts).toHaveLength(2);
      expect(result.error.attempts[0].category).toBe("RUN_ERROR");
      expect(result.error.attempts[0].issues[0]).toContain("API down");
    }
  });

  it("classifies empty response", async () => {
    const result = await enforce(
      Schema,
      async () => null,
      { maxAttempts: 1 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts[0].category).toBe("EMPTY_RESPONSE");
    }
  });

  it("classifies refusal", async () => {
    const result = await enforce(
      Schema,
      async () => "I'm sorry, I can't assist with that request.",
      { maxAttempts: 1 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts[0].category).toBe("REFUSAL");
    }
  });

  it("classifies truncated JSON", async () => {
    const result = await enforce(
      Schema,
      async () => '{"sentiment": "positive", "confidence":',
      { maxAttempts: 1 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts[0].category).toBe("TRUNCATED");
    }
  });

  it("classifies prose with no JSON", async () => {
    const result = await enforce(
      Schema,
      async () => "The sentiment is positive with high confidence.",
      { maxAttempts: 1 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts[0].category).toBe("NO_JSON");
    }
  });

  it("supports custom invariants with INVARIANT_ERROR category", async () => {
    const result = await enforce(
      Schema,
      async () => {
        return '{"sentiment": "positive", "confidence": 0.3}';
      },
      {
        maxAttempts: 1,
        invariants: [
          (d) => d.confidence >= 0.5 || "confidence too low",
        ],
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts[0].category).toBe("INVARIANT_ERROR");
      expect(result.error.attempts[0].issues[0]).toBe("confidence too low");
    }
  });

  it("stops retrying when repairs override returns false", async () => {
    let callCount = 0;
    const result = await enforce(
      Schema,
      async () => {
        callCount++;
        return "I'm sorry, I cannot help with that.";
      },
      {
        maxAttempts: 5,
        repairs: { REFUSAL: false },
      },
    );

    expect(result.ok).toBe(false);
    expect(callCount).toBe(1);
    if (!result.ok) {
      expect(result.error.attempts).toHaveLength(1);
      expect(result.error.attempts[0].category).toBe("REFUSAL");
    }
  });

  it("uses custom repair message from override", async () => {
    let callCount = 0;
    let receivedFixes: string[] = [];

    await enforce(
      Schema,
      async (attempt) => {
        callCount++;
        if (attempt.fixes.length > 0) {
          receivedFixes = attempt.fixes.map((f) => f.content);
        }
        if (callCount === 1) {
          return "";
        }
        return '{"sentiment": "positive", "confidence": 0.9}';
      },
      {
        maxAttempts: 3,
        repairs: {
          EMPTY_RESPONSE: () => [
            { role: "user", content: "CUSTOM: please provide data" },
          ],
        },
      },
    );

    expect(receivedFixes).toContain("CUSTOM: please provide data");
  });

  it("fires onAttempt hook with category", async () => {
    const events: AttemptEvent[] = [];

    await enforce(
      Schema,
      async () => {
        return '{"sentiment": "positive", "confidence": 0.9}';
      },
      {
        onAttempt: (event) => {
          events.push(event);
        },
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0].ok).toBe(true);
    expect(events[0].category).toBeUndefined();
  });

  it("fires onAttempt with category on failure", async () => {
    const events: AttemptEvent[] = [];

    await enforce(
      Schema,
      async () => "Just some text.",
      {
        maxAttempts: 1,
        onAttempt: (event) => {
          events.push(event);
        },
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0].ok).toBe(false);
    expect(events[0].category).toBe("NO_JSON");
  });

  it("provides attempt.prompt from schema", async () => {
    let receivedPrompt = "";

    await enforce(Schema, async (attempt) => {
      receivedPrompt = attempt.prompt;
      return '{"sentiment": "positive", "confidence": 0.9}';
    });

    expect(receivedPrompt).toContain("JSON");
    expect(receivedPrompt).toContain("sentiment");
  });

  it("appends promptSuffix to attempt.prompt", async () => {
    let receivedPrompt = "";

    await enforce(Schema, async (attempt) => {
      receivedPrompt = attempt.prompt;
      return '{"sentiment": "positive", "confidence": 0.9}';
    }, {
      promptSuffix: "If an optional field is unknown, omit it.",
    });

    expect(receivedPrompt).toContain("sentiment");
    expect(receivedPrompt).toContain("If an optional field is unknown, omit it.");
  });

  it("does not modify prompt when promptSuffix is not provided", async () => {
    let promptWithout = "";
    let promptWith = "";

    await enforce(Schema, async (attempt) => {
      promptWithout = attempt.prompt;
      return '{"sentiment": "positive", "confidence": 0.9}';
    });

    await enforce(Schema, async (attempt) => {
      promptWith = attempt.prompt;
      return '{"sentiment": "positive", "confidence": 0.9}';
    }, {
      promptSuffix: "Extra instruction.",
    });

    expect(promptWith).toContain(promptWithout);
    expect(promptWith).toContain("Extra instruction.");
    expect(promptWithout).not.toContain("Extra instruction.");
  });

  it("coerces string types during clean", async () => {
    const result = await enforce(Schema, async () => {
      return '{"sentiment": "positive", "confidence": "0.85"}';
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.confidence).toBe(0.85);
    }
  });
});
