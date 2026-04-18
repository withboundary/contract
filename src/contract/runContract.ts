import type { ZodType } from "zod";
import type {
  AttemptDetail,
  FailureCategory,
  Message,
  ContractResult,
  RunFn,
} from "./types.js";
import type { NormalizedContractOptions } from "./normalizeOptions.js";
import type { ContractLogger } from "../logger/types.js";
import { clean } from "../engine/clean.js";
import { classify } from "../engine/classify.js";
import { instructions as buildInstructions } from "../engine/instructions.js";
import { repair } from "../engine/repair.js";
import { computeRetryDelay, sleep } from "../engine/retry.js";
import { verify } from "../engine/verify.js";
import {
  createAttemptDetail,
  createContractError,
  failure,
} from "../result/failure.js";
import { success } from "../result/success.js";

export async function runContract<T>(
  contractName: string,
  schema: ZodType<T>,
  run: RunFn,
  options: NormalizedContractOptions<T>,
): Promise<ContractResult<T>> {
  const logger = options.logger;
  let schemaInstructions = buildInstructions(schema);
  if (options.instructions.suffix) {
    schemaInstructions = `${schemaInstructions}\n\n${options.instructions.suffix}`;
  }

  const attemptDetails: AttemptDetail[] = [];
  let currentRepairs: Message[] = [];
  let previousError: undefined | { message: string; attempts: AttemptDetail[] };
  let previousCategory: FailureCategory | undefined;

  const totalStart = Date.now();
  emitLogger(logger, "onRunStart", {
    contractName,
    maxAttempts: options.retry.maxAttempts,
    rulesCount: options.rules?.length ?? 0,
    model: options.model,
    retry: options.retry,
  });

  for (let attemptNum = 1; attemptNum <= options.retry.maxAttempts; attemptNum++) {
    const delay = computeRetryDelay(attemptNum, options.retry);
    await sleep(delay);

    const attemptContext = {
      attempt: attemptNum,
      maxAttempts: options.retry.maxAttempts,
      instructions: schemaInstructions,
      repairs: currentRepairs,
      previousError,
      previousCategory,
    };
    emitLogger(logger, "onAttemptStart", {
      contractName,
      attempt: attemptNum,
      maxAttempts: options.retry.maxAttempts,
      instructions: schemaInstructions,
      repairs: currentRepairs,
    });

    const start = Date.now();
    let raw: string;

    try {
      const result = await run(attemptContext);
      raw = result ?? "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      raw = "";
      emitLogger(logger, "onRawOutput", { contractName, attempt: attemptNum, raw });
      const detail = createAttemptDetail(
        raw,
        null,
        [`run function threw: ${message}`],
        "RUN_ERROR",
      );
      const handled = handleFailure(
        contractName,
        detail,
        attemptDetails,
        attemptNum,
        raw,
        start,
        options,
        logger,
      );
      if (handled.shouldStop) {
        const contractError = createContractError(attemptDetails);
        emitLogger(logger, "onRunFailure", {
          contractName,
          attempts: attemptDetails.length,
          category: detail.category,
          message: contractError.message,
          totalDurationMs: Date.now() - totalStart,
        });
        return failure(contractError);
      }
      currentRepairs = handled.repairs;
      previousError = createContractError(attemptDetails);
      previousCategory = detail.category;
      emitRetry(logger, contractName, attemptNum, detail.category, options.retry.maxAttempts, options.retry);
      continue;
    }

    emitLogger(logger, "onRawOutput", { contractName, attempt: attemptNum, raw });
    const cleaned = clean(raw);
    emitLogger(logger, "onCleanedOutput", { contractName, attempt: attemptNum, cleaned });
    if (cleaned === null || cleaned === undefined) {
      const category = classify(raw, cleaned);
      const detail = createAttemptDetail(
        raw,
        cleaned,
        [describeFailure(category, raw)],
        category,
      );
      const handled = handleFailure(
        contractName,
        detail,
        attemptDetails,
        attemptNum,
        raw,
        start,
        options,
        logger,
      );
      if (handled.shouldStop) {
        const contractError = createContractError(attemptDetails);
        emitLogger(logger, "onRunFailure", {
          contractName,
          attempts: attemptDetails.length,
          category: detail.category,
          message: contractError.message,
          totalDurationMs: Date.now() - totalStart,
        });
        return failure(contractError);
      }
      currentRepairs = handled.repairs;
      previousError = createContractError(attemptDetails);
      previousCategory = detail.category;
      emitRetry(logger, contractName, attemptNum, detail.category, options.retry.maxAttempts, options.retry);
      continue;
    }

    const verifyResult = verify(cleaned, schema, options.rules);
    if (!isFailureResult(verifyResult)) {
      const durationMs = Date.now() - start;
      emitAttempt(options, attemptNum, true, raw, [], durationMs);
      emitLogger(logger, "onVerifySuccess", {
        contractName,
        attempt: attemptNum,
        data: verifyResult.data,
        durationMs,
      });
      emitLogger(logger, "onRunSuccess", {
        contractName,
        attempts: attemptNum,
        data: verifyResult.data,
        totalDurationMs: Date.now() - totalStart,
      });
      return success(
        verifyResult.data,
        attemptNum,
        raw,
        Date.now() - totalStart,
      );
    }

    const verifyDetail = verifyResult.error.attempts[0];
    const detail = createAttemptDetail(
      raw,
      cleaned,
      verifyDetail?.issues ?? [],
      verifyDetail?.category ?? "VALIDATION_ERROR",
    );
    emitLogger(logger, "onVerifyFailure", {
      contractName,
      attempt: attemptNum,
      category: detail.category,
      issues: detail.issues,
      durationMs: Date.now() - start,
    });
    const handled = handleFailure(
      contractName,
      detail,
      attemptDetails,
      attemptNum,
      raw,
      start,
      options,
      logger,
    );
    if (handled.shouldStop) {
      const contractError = createContractError(attemptDetails);
      emitLogger(logger, "onRunFailure", {
        contractName,
        attempts: attemptDetails.length,
        category: detail.category,
        message: contractError.message,
        totalDurationMs: Date.now() - totalStart,
      });
      return failure(contractError);
    }
    currentRepairs = handled.repairs;
    previousError = createContractError(attemptDetails);
    previousCategory = detail.category;
    emitRetry(logger, contractName, attemptNum, detail.category, options.retry.maxAttempts, options.retry);
  }

  const contractError = createContractError(attemptDetails);
  const lastCategory = attemptDetails[attemptDetails.length - 1]?.category;
  emitLogger(logger, "onRunFailure", {
    contractName,
    attempts: attemptDetails.length,
    category: lastCategory,
    message: contractError.message,
    totalDurationMs: Date.now() - totalStart,
  });
  return failure(contractError);
}

function isFailureResult<T>(
  result: ContractResult<T>,
): result is { ok: false; error: { attempts: AttemptDetail[]; message: string } } {
  return result.ok === false;
}

function handleFailure<T>(
  contractName: string,
  detail: AttemptDetail,
  attemptDetails: AttemptDetail[],
  attemptNum: number,
  raw: string,
  start: number,
  options: NormalizedContractOptions<T>,
  logger: ContractLogger<T> | undefined,
): { shouldStop: boolean; repairs: Message[] } {
  attemptDetails.push(detail);
  emitAttempt(
    options,
    attemptNum,
    false,
    raw,
    detail.issues,
    Date.now() - start,
    detail.category,
  );

  const repairResult = repair(detail, options.repairs);
  if (repairResult === false) {
    emitLogger(logger, "onRepairGenerated", {
      contractName,
      attempt: attemptNum,
      category: detail.category,
      repairMessage: "(disabled by repair override)",
    });
    return { shouldStop: true, repairs: [] };
  }
  emitLogger(logger, "onRepairGenerated", {
    contractName,
    attempt: attemptNum,
    category: detail.category,
    repairMessage: repairResult.map((message) => message.content).join("\n"),
  });
  return { shouldStop: false, repairs: repairResult };
}

function emitAttempt<T>(
  options: NormalizedContractOptions<T>,
  number: number,
  ok: boolean,
  raw: string,
  issues: string[],
  durationMS: number,
  category?: FailureCategory,
): void {
  if (options.onAttempt) {
    options.onAttempt({ number, ok, raw, issues, durationMS, category });
  }
}

function describeFailure(category: FailureCategory, raw: string): string {
  switch (category) {
    case "EMPTY_RESPONSE":
      return "Response was empty";
    case "REFUSAL":
      return `Model refused the request: "${raw.slice(0, 100)}"`;
    case "NO_JSON":
      return `Response contained no JSON: "${raw.slice(0, 100)}"`;
    case "TRUNCATED":
      return `Response JSON was truncated/incomplete: "${raw.slice(-80)}"`;
    case "PARSE_ERROR":
      return "Response contained malformed JSON that could not be parsed";
    default:
      return "Response could not be processed";
  }
}

function emitRetry<T>(
  logger: ContractLogger<T> | undefined,
  contractName: string,
  attemptNum: number,
  category: FailureCategory,
  maxAttempts: number,
  retryPolicy: NormalizedContractOptions<T>["retry"],
): void {
  if (attemptNum >= maxAttempts) {
    return;
  }

  emitLogger(logger, "onRetryScheduled", {
    contractName,
    attempt: attemptNum,
    nextAttempt: attemptNum + 1,
    category,
    delayMs: computeRetryDelay(attemptNum + 1, retryPolicy),
  });
}

function emitLogger<T>(
  logger: ContractLogger<T> | undefined,
  hook: keyof ContractLogger<T>,
  payload: unknown,
): void {
  const callback = logger?.[hook];
  if (!callback) {
    return;
  }

  try {
    (callback as (arg: unknown) => void)(payload);
  } catch {
    return;
  }
}
