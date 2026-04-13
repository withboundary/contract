import type { ZodError, ZodType } from "zod";
import type { Rule, ContractResult } from "../contract/types.js";
import { createAttemptDetail, createContractError, failure } from "../result/failure.js";
import { success } from "../result/success.js";

export function verify<T>(
  data: unknown,
  schema: ZodType<T>,
  rules?: Rule<T>[],
): ContractResult<T> {
  const parseResult = schema.safeParse(data);

  if (!parseResult.success) {
    const issues = formatZodError(parseResult.error);
    const detail = createAttemptDetail(
      typeof data === "string" ? data : JSON.stringify(data),
      data,
      issues,
      "VALIDATION_ERROR",
    );
    return failure(createContractError([detail]));
  }

  const typed = parseResult.data;

  if (rules && rules.length > 0) {
    const ruleIssues: string[] = [];

    for (const rule of rules) {
      const result = rule(typed);
      if (result !== true) {
        ruleIssues.push(result);
      }
    }

    if (ruleIssues.length > 0) {
      const detail = createAttemptDetail(
        typeof data === "string" ? data : JSON.stringify(data),
        data,
        ruleIssues,
        "INVARIANT_ERROR",
      );
      return failure(createContractError([detail]));
    }
  }

  return success(
    typed,
    1,
    typeof data === "string" ? data : JSON.stringify(data),
    0,
  );
}

export function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}
