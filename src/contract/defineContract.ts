import type { ContractConfig, DefinedContract } from "./types.js";
import { mergeOptions } from "./normalizeOptions.js";
import { runContract } from "./runContract.js";

export function defineContract<T>(config: ContractConfig<T>): DefinedContract<T> {
  const { name, schema, ...definitionOptions } = config;

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError(
      "defineContract({ name }) is required. Give the contract a human-readable name like \"lead-scoring\".",
    );
  }

  return {
    accept(run, runtimeOptions) {
      const options = mergeOptions(definitionOptions, runtimeOptions);
      return runContract(name, schema, run, options);
    },
  };
}
