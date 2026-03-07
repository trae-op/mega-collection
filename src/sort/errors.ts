export class SortEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SortEngineError";
  }

  static missingDatasetForBuildIndex(): SortEngineError {
    return new SortEngineError(
      "SortEngine: no dataset in memory. " +
        "Either pass `data` in the constructor options, or call buildIndex(data, field).",
    );
  }

  static missingDatasetForSort(): SortEngineError {
    return new SortEngineError(
      "SortEngine: no dataset in memory. " +
        "Either pass `data` in the constructor options, or call sort(data, descriptors).",
    );
  }
}
