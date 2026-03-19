export class FilterEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterEngineError";
  }

  static missingDatasetForBuildIndex(): FilterEngineError {
    return new FilterEngineError(
      "FilterEngine: no dataset in memory. Call data() or add() before buildIndex().",
    );
  }

  static missingDatasetForFilter(): FilterEngineError {
    return new FilterEngineError(
      "FilterEngine: no dataset in memory. Call data() or add() before filter().",
    );
  }
}
