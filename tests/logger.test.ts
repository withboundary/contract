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

describe("logger", () => {
  it("does not log to console when logger is not enabled", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = await enforce(
        Schema,
        async () => '{"sentiment":"neutral","confidence":0.4}',
      );

      expect(result.ok).toBe(true);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fires logger hooks in stage order on retry then success", async () => {
    const calls: string[] = [];
    const logger: ContractLogger = {
      onRunStart() {
        calls.push("onRunStart");
      },
      onAttemptStart() {
        calls.push("onAttemptStart");
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
      onRunSuccess() {
        calls.push("onRunSuccess");
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
        logger,
        retry: { maxAttempts: 2 },
      },
    );

    expect(result.ok).toBe(true);
    expect(calls[0]).toBe("onRunStart");
    expect(calls).toContain("onVerifyFailure");
    expect(calls).toContain("onRetryScheduled");
    expect(calls[calls.length - 1]).toBe("onRunSuccess");
  });

  it("uses debug true to create default console logger", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = await enforce(
        Schema,
        async () => '{"sentiment":"neutral","confidence":0.5}',
        {
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
        logger,
      },
    );

    expect(result.ok).toBe(true);
  });

  it("createConsoleLogger supports options and works with defineContract.run", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const contract = defineContract({
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
    } finally {
      logSpy.mockRestore();
    }
  });
});
