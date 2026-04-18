import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createConsoleLogger, defineContract, enforce } from "../src/index.js";
import type { ContractAttempt, AttemptEvent, ContractLogger } from "../src/index.js";

const Schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
});

const NAME = "sentiment-test";

describe("enforce", () => {
  it("succeeds on first attempt with valid JSON", async () => {
    const result = await enforce(Schema, async () => {
      return '{"sentiment": "positive", "confidence": 0.95}';
    }, { name: NAME });

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
    }, { name: NAME });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sentiment).toBe("negative");
    }
  });

  it("repairs and succeeds on retry", async () => {
    let callCount = 0;
    const result = await enforce(Schema, async (attempt: ContractAttempt) => {
      callCount++;
      if (callCount === 1) {
        return '{"sentiment": "great", "confidence": 0.9}';
      }
      expect(attempt.repairs.length).toBeGreaterThan(0);
      expect(attempt.previousCategory).toBe("VALIDATION_ERROR");
      return '{"sentiment": "positive", "confidence": 0.9}';
    }, { name: NAME });

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
      { name: NAME, retry: { maxAttempts: 2 } },
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
      { name: NAME, retry: { maxAttempts: 3 } },
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
      { name: NAME, retry: { maxAttempts: 2 } },
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
      { name: NAME, retry: { maxAttempts: 1 } },
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
      { name: NAME, retry: { maxAttempts: 1 } },
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
      { name: NAME, retry: { maxAttempts: 1 } },
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
      { name: NAME, retry: { maxAttempts: 1 } },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.attempts[0].category).toBe("NO_JSON");
    }
  });

  it("supports custom rules with INVARIANT_ERROR category", async () => {
    const result = await enforce(
      Schema,
      async () => {
        return '{"sentiment": "positive", "confidence": 0.3}';
      },
      {
        name: NAME,
        retry: { maxAttempts: 1 },
        rules: [
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
        name: NAME,
        retry: { maxAttempts: 5 },
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
        if (attempt.repairs.length > 0) {
          receivedFixes = attempt.repairs.map((f) => f.content);
        }
        if (callCount === 1) {
          return "";
        }
        return '{"sentiment": "positive", "confidence": 0.9}';
      },
      {
        name: NAME,
        retry: { maxAttempts: 3 },
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
        name: NAME,
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
        name: NAME,
        retry: { maxAttempts: 1 },
        onAttempt: (event) => {
          events.push(event);
        },
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0].ok).toBe(false);
    expect(events[0].category).toBe("NO_JSON");
  });

  it("provides attempt.instructions from schema", async () => {
    let receivedInstructions = "";

    await enforce(Schema, async (attempt) => {
      receivedInstructions = attempt.instructions;
      return '{"sentiment": "positive", "confidence": 0.9}';
    }, { name: NAME });

    expect(receivedInstructions).toContain("JSON");
    expect(receivedInstructions).toContain("sentiment");
  });

  it("appends instructions.suffix to attempt.instructions", async () => {
    let receivedInstructions = "";

    await enforce(Schema, async (attempt) => {
      receivedInstructions = attempt.instructions;
      return '{"sentiment": "positive", "confidence": 0.9}';
    }, {
      name: NAME,
      instructions: {
        suffix: "If an optional field is unknown, omit it.",
      },
    });

    expect(receivedInstructions).toContain("sentiment");
    expect(receivedInstructions).toContain(
      "If an optional field is unknown, omit it.",
    );
  });

  it("does not modify instructions when suffix is not provided", async () => {
    let instructionsWithout = "";
    let instructionsWith = "";

    await enforce(Schema, async (attempt) => {
      instructionsWithout = attempt.instructions;
      return '{"sentiment": "positive", "confidence": 0.9}';
    }, { name: NAME });

    await enforce(Schema, async (attempt) => {
      instructionsWith = attempt.instructions;
      return '{"sentiment": "positive", "confidence": 0.9}';
    }, {
      name: NAME,
      instructions: {
        suffix: "Extra instruction.",
      },
    });

    expect(instructionsWith).toContain(instructionsWithout);
    expect(instructionsWith).toContain("Extra instruction.");
    expect(instructionsWithout).not.toContain("Extra instruction.");
  });

  it("coerces string types during clean", async () => {
    const result = await enforce(Schema, async () => {
      return '{"sentiment": "positive", "confidence": "0.85"}';
    }, { name: NAME });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.confidence).toBe(0.85);
    }
  });

  it("supports defineContract with runtime option overrides", async () => {
    const contract = defineContract({
      name: NAME,
      schema: Schema,
      retry: { maxAttempts: 2 },
      instructions: { suffix: "Base suffix." },
    });

    let receivedInstructions = "";
    let attempts = 0;

    const result = await contract.accept(async (attempt) => {
      attempts++;
      receivedInstructions = attempt.instructions;
      if (attempts === 1) {
        return "invalid";
      }
      return '{"sentiment":"positive","confidence":0.7}';
    }, {
      instructions: { suffix: "Runtime suffix." },
      retry: { maxAttempts: 3 },
    });

    expect(result.ok).toBe(true);
    expect(receivedInstructions).toContain("Runtime suffix.");
    expect(receivedInstructions).not.toContain("Base suffix.");
  });

  it("runs custom logger and onAttempt together", async () => {
    const loggerCalls: string[] = [];
    const attemptEvents: AttemptEvent[] = [];
    const logger: ContractLogger = {
      onAttemptStart() {
        loggerCalls.push("onAttemptStart");
      },
      onRunSuccess() {
        loggerCalls.push("onRunSuccess");
      },
    };

    const result = await enforce(
      Schema,
      async () => '{"sentiment":"positive","confidence":0.92}',
      {
        name: NAME,
        logger,
        onAttempt: (event) => {
          attemptEvents.push(event);
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(loggerCalls).toEqual(["onAttemptStart", "onRunSuccess"]);
    expect(attemptEvents).toHaveLength(1);
    expect(attemptEvents[0].ok).toBe(true);
  });

  it("supports debug convenience mode", async () => {
    const logger = createConsoleLogger();

    const result = await enforce(
      Schema,
      async () => '{"sentiment":"neutral","confidence":0.88}',
      {
        name: NAME,
        debug: true,
        logger,
      },
    );

    expect(result.ok).toBe(true);
  });

  it("throws TypeError when name is missing", () => {
    expect(() =>
      // @ts-expect-error intentionally missing name to verify runtime guard
      defineContract({ schema: Schema }),
    ).toThrow(TypeError);
  });

  it("throws TypeError when name is empty string", () => {
    expect(() => defineContract({ name: "   ", schema: Schema })).toThrow(
      TypeError,
    );
  });
});
