import type { ZodType } from "zod";
import type {
  Result,
  EnforceOptions,
  AttemptContext,
  AttemptDetail,
  FailureCategory,
  RunFn,
} from "./types.js";
import { success, failure } from "./types.js";
import { createContractError, createAttemptDetail } from "./errors.js";
import { prompt as generatePrompt } from "./prompt.js";
import { clean } from "./clean.js";
import { check } from "./check.js";
import { fix } from "./fix.js";
import { classify } from "./classify.js";
import { resolvePolicy, computeDelay, sleep } from "./retry.js";

export async function enforce<T>(
  schema: ZodType<T>,
  run: RunFn,
  options?: EnforceOptions<T>,
): Promise<Result<T>> {
  const policy = resolvePolicy({
    maxAttempts: options?.maxAttempts,
    backoff: options?.backoff,
    backoffBaseMS: options?.backoffBaseMS,
  });

  let schemaPrompt = generatePrompt(schema);
  if (options?.promptSuffix) {
    schemaPrompt = `${schemaPrompt}\n\n${options.promptSuffix}`;
  }
  const attemptDetails: AttemptDetail[] = [];
  let currentFixes: AttemptContext["fixes"] = [];
  let previousError: AttemptContext["previousError"] = undefined;
  let previousCategory: AttemptContext["previousCategory"] = undefined;

  const totalStart = Date.now();

  for (let attemptNum = 1; attemptNum <= policy.maxAttempts; attemptNum++) {
    const delay = computeDelay(attemptNum, policy);
    await sleep(delay);

    const attemptContext: AttemptContext = {
      prompt: schemaPrompt,
      fixes: currentFixes,
      number: attemptNum,
      previousError,
      previousCategory,
    };

    const start = Date.now();
    let raw: string;

    try {
      const result = await run(attemptContext);
      raw = result ?? "";
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      raw = "";
      const detail = createAttemptDetail(
        raw,
        null,
        [`run function threw: ${message}`],
        "RUN_ERROR",
      );

      const shouldStop = recordFailure(
        detail,
        attemptDetails,
        attemptNum,
        raw,
        start,
        options,
      );
      if (shouldStop) {
        return failure(createContractError(attemptDetails));
      }

      const contractError = createContractError(attemptDetails);
      currentFixes = fix(detail, options?.repairs) as AttemptContext["fixes"];
      previousError = contractError;
      previousCategory = detail.category;
      continue;
    }

    const cleaned = clean(raw);

    if (cleaned === null || cleaned === undefined) {
      const category = classify(raw, cleaned);
      const detail = createAttemptDetail(
        raw,
        cleaned,
        [describeFailure(category, raw)],
        category,
      );

      const shouldStop = recordFailure(
        detail,
        attemptDetails,
        attemptNum,
        raw,
        start,
        options,
      );
      if (shouldStop) {
        return failure(createContractError(attemptDetails));
      }

      const contractError = createContractError(attemptDetails);
      currentFixes = fix(detail, options?.repairs) as AttemptContext["fixes"];
      previousError = contractError;
      previousCategory = category;
      continue;
    }

    const checkResult = check(cleaned, schema, options?.invariants);

    if (checkResult.ok) {
      emitAttempt(options, attemptNum, true, raw, [], Date.now() - start, undefined);
      return success(checkResult.data, attemptNum, raw, Date.now() - totalStart);
    }

    const checkDetail = checkResult.error.attempts[0];
    const detail = createAttemptDetail(
      raw,
      cleaned,
      checkDetail?.issues ?? [],
      checkDetail?.category ?? "VALIDATION_ERROR",
    );

    const shouldStop = recordFailure(
      detail,
      attemptDetails,
      attemptNum,
      raw,
      start,
      options,
    );
    if (shouldStop) {
      return failure(createContractError(attemptDetails));
    }

    const contractError = createContractError(attemptDetails);
    currentFixes = fix(detail, options?.repairs) as AttemptContext["fixes"];
    previousError = contractError;
    previousCategory = detail.category;
  }

  return failure(createContractError(attemptDetails));
}

function recordFailure<T>(
  detail: AttemptDetail,
  attemptDetails: AttemptDetail[],
  attemptNum: number,
  raw: string,
  start: number,
  options: EnforceOptions<T> | undefined,
): boolean {
  attemptDetails.push(detail);
  emitAttempt(options, attemptNum, false, raw, detail.issues, Date.now() - start, detail.category);

  const fixResult = fix(detail, options?.repairs);
  return fixResult === false;
}

function emitAttempt<T>(
  options: EnforceOptions<T> | undefined,
  number: number,
  ok: boolean,
  raw: string,
  issues: string[],
  durationMS: number,
  category: FailureCategory | undefined,
): void {
  if (options?.onAttempt) {
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
