import type { ZodType } from "zod";
import type { ContractLogger } from "../logger/types.js";

export type FailureCategory =
  | "EMPTY_RESPONSE"
  | "REFUSAL"
  | "NO_JSON"
  | "TRUNCATED"
  | "PARSE_ERROR"
  | "VALIDATION_ERROR"
  | "INVARIANT_ERROR"
  | "RUN_ERROR";

export interface Message {
  role: string;
  content: string;
}

export interface AttemptDetail {
  raw: string;
  cleaned: unknown;
  issues: string[];
  category: FailureCategory;
}

export interface ContractError {
  message: string;
  attempts: AttemptDetail[];
}

export interface ContractAttempt {
  attempt: number;
  maxAttempts: number;
  instructions: string;
  repairs: Message[];
  previousError?: ContractError;
  previousCategory?: FailureCategory;
}

export type Rule<T> = (data: T) => true | string;
export type RepairFn = (detail: AttemptDetail) => Message[];

export interface AttemptEvent {
  number: number;
  ok: boolean;
  raw: string;
  issues: string[];
  durationMS: number;
  category?: FailureCategory;
}

export type AttemptHook = (event: AttemptEvent) => void;

export type RetryBackoff = "none" | "linear" | "exponential";

export interface RetryPolicy {
  maxAttempts: number;
  backoff: RetryBackoff;
  baseMs: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  backoff?: RetryBackoff;
  baseMs?: number;
}

export interface InstructionsOptions {
  suffix?: string;
}

export interface ContractOptions<T = unknown> {
  rules?: Rule<T>[];
  repairs?: Partial<Record<FailureCategory, RepairFn | false>>;
  retry?: RetryOptions;
  instructions?: InstructionsOptions;
  onAttempt?: AttemptHook;
  logger?: ContractLogger<T>;
  debug?: boolean;
}

export type RunFn = (attempt: ContractAttempt) => Promise<string | null>;

export type ContractResult<T> = Success<T> | Failure;

export interface Success<T> {
  ok: true;
  data: T;
  attempts: number;
  raw: string;
  durationMS: number;
}

export interface Failure {
  ok: false;
  error: ContractError;
}

export interface DefinedContract<T> {
  accept: (
    run: RunFn,
    runtimeOptions?: ContractOptions<T>,
  ) => Promise<ContractResult<T>>;
}

export interface ContractConfig<T> extends ContractOptions<T> {
  schema: ZodType<T>;
}
