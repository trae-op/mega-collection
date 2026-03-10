export class SortEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SortEngineError";
  }

  static missingDatasetForBuildIndex(): SortEngineError {
    return new SortEngineError("SortEngine: no dataset in memory.");
  }

  static missingDatasetForSort(): SortEngineError {
    return new SortEngineError("SortEngine: no dataset in memory.");
  }
}
