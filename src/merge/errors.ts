import type { MergeModuleName } from "./chain";

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
      `MergeEngines: Method "${methodName}" is not available. ` +
        `Add module with method "${methodName}" to the \`imports\` array.`,
    );
  }

  static unavailableEngine(module: MergeModuleName): MergeEnginesError {
    const engineName = MODULE_TO_ENGINE[module];

    return new MergeEnginesError(
      `MergeEngines: ${engineName} is not available. ` +
        `Add ${engineName} to the \`imports\` array.`,
    );
  }

  static unavailableGetOriginData(): MergeEnginesError {
    return new MergeEnginesError(
      "MergeEngines: getOriginData is not available. " +
        "Add TextSearchEngine, SortEngine, or FilterEngine to the `imports` array.",
    );
  }
}
