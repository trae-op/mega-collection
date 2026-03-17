import type { MergeModuleName } from "./types";
import { MODULE_TO_ENGINE } from "./constants";

export class MergeEnginesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeEnginesError";
  }

  static unavailableEngine(module: MergeModuleName): MergeEnginesError {
    const engineName = MODULE_TO_ENGINE[module];

    return new MergeEnginesError(
      `MergeEngines: ${engineName} is not available.`,
    );
  }

  static unavailableGetOriginData(): MergeEnginesError {
    return new MergeEnginesError(
      "MergeEngines: getOriginData is not available.",
    );
  }

  static invalidFilterByPreviousResultOption(): MergeEnginesError {
    return new MergeEnginesError(
      'MergeEngines: "filter.filterByPreviousResult" is not supported. Configure "filterByPreviousResult" on the MergeEngines root options.',
    );
  }
}
