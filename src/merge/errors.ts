import type { MergeModuleName } from "./types";

const MODULE_TO_ENGINE = {
  search: "TextSearchEngine",
  sort: "SortEngine",
  filter: "FilterEngine",
} as const;

export class MergeEnginesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeEnginesError";
  }

  static unavailableMethod(methodName: string): MergeEnginesError {
    return new MergeEnginesError(
      `MergeEngines: Method "${methodName}" is not available.`,
    );
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
}
