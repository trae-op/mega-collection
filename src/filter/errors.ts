export class FilterEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterEngineError";
  }

  static missingDatasetForBuildIndex(): FilterEngineError {
    return new FilterEngineError(
      "FilterEngine: no dataset in memory. " +
        "Either pass `data` in the constructor options, or call buildIndex(data, field).",
    );
  }

  static missingDatasetForFilter(): FilterEngineError {
    return new FilterEngineError(
      "FilterEngine: no dataset in memory. " +
        "Either pass `data` in the constructor options, or call filter(data, criteria).",
    );
  }

  static duplicateMutableExcludeField(field: string): FilterEngineError {
    return new FilterEngineError(
      `FilterEngine: cannot use mutable exclude on field \`${field}\` because it contains duplicate values.`,
    );
  }
}
