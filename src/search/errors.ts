export class TextSearchEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextSearchEngineError";
  }

  static missingDatasetForBuildIndex(): TextSearchEngineError {
    return new TextSearchEngineError("TextSearchEngine: no dataset in memory.");
  }
}
