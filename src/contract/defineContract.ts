import type { ContractConfig, DefinedContract } from "./types.js";
import { mergeOptions } from "./normalizeOptions.js";
import { runContract } from "./runContract.js";

export function defineContract<T>(config: ContractConfig<T>): DefinedContract<T> {
  const { schema, ...definitionOptions } = config;

  return {
    accept(run, runtimeOptions) {
      const options = mergeOptions(definitionOptions, runtimeOptions);
      return runContract(schema, run, options);
    },
  };
}
