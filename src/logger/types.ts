export type RetryBackoffMode = "none" | "linear" | "exponential";

export interface ConsoleLoggerOptions {
  prefix?: string;
  showInstructions?: boolean;
  showRepairs?: boolean;
  showRawOutput?: boolean;
  showCleanedOutput?: boolean;
  showSuccessData?: boolean;
  maxStringLength?: number;
}

// Every hook ctx includes `contractName` — the `name` set on defineContract —
// so loggers can attribute events to the right contract without holding a
// separate reference.
export type ContractLogger<T = unknown> = {
  onRunStart?: (ctx: {
    contractName: string;
    maxAttempts: number;
    hasRules: boolean;
    retry: {
      maxAttempts: number;
      backoff: RetryBackoffMode;
      baseMs: number;
    };
  }) => void;
  onAttemptStart?: (ctx: {
    contractName: string;
    attempt: number;
    maxAttempts: number;
    instructions: string;
    repairs: Array<unknown>;
  }) => void;
  onRawOutput?: (ctx: {
    contractName: string;
    attempt: number;
    raw: string;
  }) => void;
  onCleanedOutput?: (ctx: {
    contractName: string;
    attempt: number;
    cleaned: unknown;
  }) => void;
  onVerifySuccess?: (ctx: {
    contractName: string;
    attempt: number;
    data: T;
    durationMs: number;
  }) => void;
  onVerifyFailure?: (ctx: {
    contractName: string;
    attempt: number;
    category: string;
    issues: string[];
    durationMs: number;
  }) => void;
  onRepairGenerated?: (ctx: {
    contractName: string;
    attempt: number;
    category: string;
    repairMessage: string;
  }) => void;
  onRetryScheduled?: (ctx: {
    contractName: string;
    attempt: number;
    nextAttempt: number;
    category: string;
    delayMs: number;
  }) => void;
  onRunSuccess?: (ctx: {
    contractName: string;
    attempts: number;
    data: T;
    totalDurationMs: number;
  }) => void;
  onRunFailure?: (ctx: {
    contractName: string;
    attempts: number;
    category?: string;
    message: string;
    totalDurationMs: number;
  }) => void;
};
