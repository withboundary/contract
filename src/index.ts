// ── Primary API ──────────────────────────────────────────────────────────────
export { defineContract } from "./contract/defineContract.js";
export { enforce } from "./contract/enforce.js";

// ── Engine primitives ────────────────────────────────────────────────────────
export { clean } from "./engine/clean.js";
export { verify } from "./engine/verify.js";
export { repair } from "./engine/repair.js";
export { instructions } from "./engine/instructions.js";
export { classify } from "./engine/classify.js";

// ── Observability ────────────────────────────────────────────────────────────
export { createConsoleLogger } from "./logger/createConsoleLogger.js";

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  ContractAttempt,
  AttemptDetail,
  AttemptEvent,
  AttemptHook,
  BoundaryLogEvent,
  ContractConfig,
  ContractError,
  ContractOptions,
  ContractResult,
  DefinedContract,
  FailureCategory,
  InstructionsOptions,
  Message,
  RepairFn,
  RetryBackoff,
  RetryOptions,
  RetryPolicy,
  Rule,
  RunFn,
} from "./contract/types.js";

export type { ContractLogger, ConsoleLoggerOptions } from "./logger/types.js";
