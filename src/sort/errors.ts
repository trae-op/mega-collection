export class SortEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SortEngineError";
  }

  static missingDatasetForSort(): SortEngineError {
    return new SortEngineError("SortEngine: no dataset in memory.");
  }
}
