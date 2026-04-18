import { block, heading, joinLines, stringifyUnknown } from "./format.js";
import type { ConsoleLoggerOptions, ContractLogger } from "./types.js";

const DEFAULT_OPTIONS: Required<ConsoleLoggerOptions> = {
  prefix: "[boundary]",
  showInstructions: false,
  showRepairs: true,
  showRawOutput: true,
  showCleanedOutput: false,
  showSuccessData: true,
  maxStringLength: 800,
};

export function createConsoleLogger<T = unknown>(
  options: ConsoleLoggerOptions = {},
): ContractLogger<T> {
  const resolvedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const print = (...lines: string[]): void => {
    console.log(joinLines(lines));
  };

  // Format the prefix with the contract name so lines read:
  //   [boundary] lead-scoring · Run started
  // instead of hiding the contract identity in a separate line.
  const scoped = (contractName: string): string =>
    `${resolvedOptions.prefix} ${contractName} ·`;

  return {
    onRunStart(ctx) {
      const lines = [
        heading(scoped(ctx.contractName), "Run started"),
        `Attempts: ${ctx.maxAttempts}`,
        `Rules: ${ctx.rulesCount > 0 ? ctx.rulesCount : "none"}`,
        `Backoff: ${ctx.retry.backoff}`,
      ];
      if (ctx.model) lines.splice(3, 0, `Model: ${ctx.model}`);
      print(...lines);
    },
    onAttemptStart(ctx) {
      const lines: string[] = [
        heading(
          scoped(ctx.contractName),
          `Attempt ${ctx.attempt}/${ctx.maxAttempts}`,
        ),
      ];
      if (resolvedOptions.showInstructions) {
        lines.push(
          ...block(
            "Instructions:",
            stringifyUnknown(ctx.instructions, resolvedOptions),
          ),
        );
      }
      if (resolvedOptions.showRepairs) {
        const repairsBody =
          ctx.repairs.length === 0
            ? "(none)"
            : stringifyUnknown(ctx.repairs, resolvedOptions);
        lines.push(...block("Repairs:", repairsBody));
      }
      print(...lines);
    },
    onRawOutput(ctx) {
      if (!resolvedOptions.showRawOutput) {
        return;
      }
      print(
        heading(scoped(ctx.contractName), `Raw output (attempt ${ctx.attempt})`),
        stringifyUnknown(ctx.raw, resolvedOptions),
      );
    },
    onCleanedOutput(ctx) {
      if (!resolvedOptions.showCleanedOutput) {
        return;
      }
      print(
        heading(
          scoped(ctx.contractName),
          `Cleaned output (attempt ${ctx.attempt})`,
        ),
        stringifyUnknown(ctx.cleaned, resolvedOptions),
      );
    },
    onVerifySuccess(ctx) {
      const lines = [
        heading(
          scoped(ctx.contractName),
          `Verification passed (attempt ${ctx.attempt})`,
        ),
        `Duration: ${ctx.durationMs}ms`,
      ];
      if (resolvedOptions.showSuccessData) {
        lines.push("Result data:", stringifyUnknown(ctx.data, resolvedOptions));
      }
      print(...lines);
    },
    onVerifyFailure(ctx) {
      print(
        heading(
          scoped(ctx.contractName),
          `Verification failed (attempt ${ctx.attempt})`,
        ),
        `Category: ${ctx.category}`,
        `Issues:\n${ctx.issues.map((issue) => `- ${issue}`).join("\n")}`,
        `Duration: ${ctx.durationMs}ms`,
      );
    },
    onRepairGenerated(ctx) {
      print(
        heading(
          scoped(ctx.contractName),
          `Repair generated (attempt ${ctx.attempt})`,
        ),
        `Category: ${ctx.category}`,
        ctx.repairMessage,
      );
    },
    onRetryScheduled(ctx) {
      print(
        heading(
          scoped(ctx.contractName),
          `Retry scheduled (attempt ${ctx.attempt})`,
        ),
        `Next attempt: ${ctx.nextAttempt}`,
        `Category: ${ctx.category}`,
        `Delay: ${ctx.delayMs}ms`,
      );
    },
    onRunSuccess(ctx) {
      print(
        heading(scoped(ctx.contractName), "Run succeeded"),
        `Attempts: ${ctx.attempts}`,
        `Total duration: ${ctx.totalDurationMs}ms`,
      );
    },
    onRunFailure(ctx) {
      print(
        heading(scoped(ctx.contractName), "Run failed"),
        `Attempts: ${ctx.attempts}`,
        `Category: ${ctx.category ?? "unknown"}`,
        `Message: ${ctx.message}`,
        `Total duration: ${ctx.totalDurationMs}ms`,
      );
    },
  };
}
