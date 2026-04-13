import type { ZodType } from "zod";
import { defineContract } from "./defineContract.js";
import type { ContractOptions, ContractResult, RunFn } from "./types.js";

export function enforce<T>(
  schema: ZodType<T>,
  runFn: RunFn,
  options?: ContractOptions<T>,
): Promise<ContractResult<T>> {
  const contract = defineContract({ schema, ...(options ?? {}) });
  return contract.accept(runFn);
}
