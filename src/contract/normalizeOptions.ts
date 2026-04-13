import type { ContractOptions, RetryPolicy } from "./types.js";
import { DEFAULT_RETRY_POLICY } from "../engine/retry.js";
import { createConsoleLogger } from "../logger/createConsoleLogger.js";
import type { ContractLogger } from "../logger/types.js";

export interface NormalizedContractOptions<T> {
  rules?: ContractOptions<T>["rules"];
  repairs?: ContractOptions<T>["repairs"];
  retry: RetryPolicy;
  instructions: {
    suffix?: string;
  };
  onAttempt?: ContractOptions<T>["onAttempt"];
  logger?: ContractLogger<T>;
}

export function normalizeOptions<T>(
  options?: ContractOptions<T>,
): NormalizedContractOptions<T> {
  return {
    rules: options?.rules,
    repairs: options?.repairs,
    retry: {
      maxAttempts: options?.retry?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
      backoff: options?.retry?.backoff ?? DEFAULT_RETRY_POLICY.backoff,
      baseMs: options?.retry?.baseMs ?? DEFAULT_RETRY_POLICY.baseMs,
    },
    instructions: {
      suffix: options?.instructions?.suffix,
    },
    onAttempt: options?.onAttempt,
    logger: resolveLogger(options),
  };
}

export function mergeOptions<T>(
  base?: ContractOptions<T>,
  override?: ContractOptions<T>,
): NormalizedContractOptions<T> {
  if (!base && !override) {
    return normalizeOptions<T>();
  }

  return normalizeOptions({
    rules: override?.rules ?? base?.rules,
    repairs: override?.repairs ?? base?.repairs,
    retry: {
      maxAttempts:
        override?.retry?.maxAttempts ?? base?.retry?.maxAttempts,
      backoff: override?.retry?.backoff ?? base?.retry?.backoff,
      baseMs: override?.retry?.baseMs ?? base?.retry?.baseMs,
    },
    instructions: {
      suffix:
        override?.instructions?.suffix ?? base?.instructions?.suffix,
    },
    onAttempt: override?.onAttempt ?? base?.onAttempt,
    logger: override?.logger ?? base?.logger,
    debug: override?.debug ?? base?.debug,
  });
}

function resolveLogger<T>(
  options?: ContractOptions<T>,
): ContractLogger<T> | undefined {
  if (options?.logger) {
    return options.logger;
  }
  if (options?.debug) {
    return createConsoleLogger<T>();
  }
  return undefined;
}
