export class FilterEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterEngineError";
  }

  static missingDatasetForBuildIndex(): FilterEngineError {
    return new FilterEngineError("FilterEngine: no dataset in memory.");
  }

  static missingDatasetForFilter(): FilterEngineError {
    return new FilterEngineError("FilterEngine: no dataset in memory.");
  }

  static duplicateMutableExcludeField(field: string): FilterEngineError {
    return new FilterEngineError(
      `FilterEngine: cannot use mutable exclude on field \`${field}\` because it contains duplicate values.`,
    );
  }
}
