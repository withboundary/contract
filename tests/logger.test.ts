import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createConsoleLogger,
  defineContract,
  enforce,
  type ContractLogger,
} from "../src/index.js";

const Schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
});

const NAME = "sentiment-logger-test";

describe("logger", () => {
  it("does not log to console when logger is not enabled", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = await enforce(
        Schema,
        async () => '{"sentiment":"neutral","confidence":0.4}',
        { name: NAME },
      );

      expect(result.ok).toBe(true);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fires logger hooks in stage order on retry then success", async () => {
    const calls: string[] = [];
    const contractNames: string[] = [];
    const logger: ContractLogger = {
      onRunStart(ctx) {
        calls.push("onRunStart");
        contractNames.push(ctx.contractName);
      },
      onAttemptStart(ctx) {
        calls.push("onAttemptStart");
        contractNames.push(ctx.contractName);
      },
      onRawOutput() {
        calls.push("onRawOutput");
      },
      onCleanedOutput() {
        calls.push("onCleanedOutput");
      },
      onVerifyFailure() {
        calls.push("onVerifyFailure");
      },
      onRepairGenerated() {
        calls.push("onRepairGenerated");
      },
      onRetryScheduled() {
        calls.push("onRetryScheduled");
      },
      onVerifySuccess() {
        calls.push("onVerifySuccess");
      },
      onRunSuccess(ctx) {
        calls.push("onRunSuccess");
        contractNames.push(ctx.contractName);
      },
    };

    let attempt = 0;
    const result = await enforce(
      Schema,
      async () => {
        attempt++;
        if (attempt === 1) {
          return '{"sentiment":"positive","confidence":2}';
        }
        return '{"sentiment":"positive","confidence":0.8}';
      },
      {
        name: NAME,
        logger,
        retry: { maxAttempts: 2 },
      },
    );

    expect(result.ok).toBe(true);
    expect(calls[0]).toBe("onRunStart");
    expect(calls).toContain("onVerifyFailure");
    expect(calls).toContain("onRetryScheduled");
    expect(calls[calls.length - 1]).toBe("onRunSuccess");
    // Every hook that captured ctx.contractName should have the right name.
    expect(contractNames.every((n) => n === NAME)).toBe(true);
  });

  it("uses debug true to create default console logger", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = await enforce(
        Schema,
        async () => '{"sentiment":"neutral","confidence":0.5}',
        {
          name: NAME,
          debug: true,
        },
      );

      expect(result.ok).toBe(true);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("custom logger takes precedence when debug is true", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const calls: string[] = [];

    const logger: ContractLogger = {
      onRunStart() {
        calls.push("start");
      },
      onRunSuccess() {
        calls.push("success");
      },
    };

    try {
      const result = await enforce(
        Schema,
        async () => '{"sentiment":"positive","confidence":0.77}',
        {
          name: NAME,
          debug: true,
          logger,
        },
      );

      expect(result.ok).toBe(true);
      expect(calls).toEqual(["start", "success"]);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("onRunStart receives rulesCount matching rules.length", async () => {
    const starts: Array<{ rulesCount: number; model?: string }> = [];
    const logger: ContractLogger = {
      onRunStart(ctx) {
        starts.push({ rulesCount: ctx.rulesCount, model: ctx.model });
      },
    };

    // No rules defined — rulesCount should be 0.
    await enforce(
      Schema,
      async () => '{"sentiment":"neutral","confidence":0.5}',
      { name: NAME, logger },
    );
    expect(starts[0]?.rulesCount).toBe(0);

    // Two rules defined — rulesCount should be 2.
    starts.length = 0;
    await enforce(
      Schema,
      async () => '{"sentiment":"positive","confidence":0.9}',
      {
        name: NAME,
        logger,
        rules: [
          (d) => d.confidence >= 0.5 || "confidence too low",
          (d) => d.sentiment !== "neutral" || "neutral not allowed",
        ],
      },
    );
    expect(starts[0]?.rulesCount).toBe(2);
  });

  it("per-call model override flows into onRunStart ctx", async () => {
    const starts: Array<string | undefined> = [];
    const logger: ContractLogger = {
      onRunStart(ctx) {
        starts.push(ctx.model);
      },
    };

    const contract = defineContract({
      name: NAME,
      schema: Schema,
      logger,
      model: "gpt-4o",
    });

    await contract.accept(async () => '{"sentiment":"positive","confidence":0.9}');
    await contract.accept(
      async () => '{"sentiment":"negative","confidence":0.8}',
      { model: "claude-haiku-4-5" },
    );

    expect(starts).toEqual(["gpt-4o", "claude-haiku-4-5"]);
  });

  it("logger errors do not break run behavior", async () => {
    const logger: ContractLogger = {
      onRunStart() {
        throw new Error("logger failed");
      },
      onAttemptStart() {
        throw new Error("logger failed");
      },
    };

    const result = await enforce(
      Schema,
      async () => '{"sentiment":"neutral","confidence":0.66}',
      {
        name: NAME,
        logger,
      },
    );

    expect(result.ok).toBe(true);
  });

  it("createConsoleLogger supports options and works with defineContract.run", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const contract = defineContract({
        name: NAME,
        schema: Schema,
        logger: createConsoleLogger({
          showInstructions: true,
          showCleanedOutput: true,
        }),
      });

      const result = await contract.accept(async () => {
        return '{"sentiment":"negative","confidence":0.9}';
      });

      expect(result.ok).toBe(true);
      expect(logSpy).toHaveBeenCalled();
      // Contract name should show up in the console output so users can tell
      // which contract each line came from.
      const calls = logSpy.mock.calls.map((args) => args.join(" "));
      expect(calls.some((line) => line.includes(NAME))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});
