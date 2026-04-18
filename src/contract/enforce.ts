import type { ZodType } from "zod";
import { defineContract } from "./defineContract.js";
import type { ContractOptions, ContractResult, RunFn } from "./types.js";

// Shortcut for one-off contracts. `options.name` is required \u2014 every run
// needs identity for logging, tracing, and the dashboard.
export function enforce<T>(
  schema: ZodType<T>,
  runFn: RunFn,
  options: ContractOptions<T> & { name: string },
): Promise<ContractResult<T>> {
  const { name, ...rest } = options;
  const contract = defineContract({ name, schema, ...rest });
  return contract.accept(runFn);
}
