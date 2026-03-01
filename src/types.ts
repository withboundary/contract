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

export interface AttemptContext {
  prompt: string;
  fixes: Message[];
  number: number;
  previousError?: ContractError;
  previousCategory?: FailureCategory;
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

export type Invariant<T> = (data: T) => true | string;

export type RepairFn = (detail: AttemptDetail) => Message[];

export interface EnforceOptions<T = unknown> {
  maxAttempts?: number;
  backoff?: "none" | "linear" | "exponential";
  backoffBaseMS?: number;
  invariants?: Invariant<T>[];
  onAttempt?: AttemptHook;
  repairs?: Partial<Record<FailureCategory, RepairFn | false>>;
  promptSuffix?: string;
}

export interface AttemptEvent {
  number: number;
  ok: boolean;
  raw: string;
  issues: string[];
  durationMS: number;
  category?: FailureCategory;
}

export type AttemptHook = (event: AttemptEvent) => void;

export interface RetryPolicy {
  maxAttempts: number;
  backoff: "none" | "linear" | "exponential";
  backoffBaseMS: number;
}

export type RunFn = (attempt: AttemptContext) => Promise<string | null>;

export type Result<T> = Success<T> | Failure;

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

export function success<T>(
  data: T,
  attempts: number,
  raw: string,
  durationMS: number,
): Success<T> {
  return { ok: true, data, attempts, raw, durationMS };
}

export function failure(error: ContractError): Failure {
  return { ok: false, error };
}
