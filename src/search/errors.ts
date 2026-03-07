export class TextSearchEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextSearchEngineError";
  }

  static missingDatasetForBuildIndex(): TextSearchEngineError {
    return new TextSearchEngineError(
      "TextSearchEngine: no dataset in memory. " +
        "Either pass `data` in the constructor options, or call buildIndex(data, field).",
    );
  }
}
