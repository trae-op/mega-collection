import type { CollectionItem } from "../types";
import type {
  TextSearchEngineChain,
  TextSearchEngineChainCallbacks,
} from "./types";

export type { TextSearchEngineChain } from "./types";

export class TextSearchEngineChainBuilder<T extends CollectionItem> {
  constructor(private readonly callbacks: TextSearchEngineChainCallbacks<T>) {}

  create(result: T[]): T[] & TextSearchEngineChain<T> {
    const chainResult = result as T[] & TextSearchEngineChain<T>;

    Object.defineProperty(chainResult, "search", {
      value: (fieldOrQuery: string, maybeQuery?: string) =>
        maybeQuery === undefined
          ? this.callbacks.search(fieldOrQuery)
          : this.callbacks.search(fieldOrQuery, maybeQuery),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "clearIndexes", {
      value: () => this.callbacks.clearIndexes(),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "getOriginData", {
      value: () => this.callbacks.getOriginData(),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "data", {
      value: (data: T[]) => this.callbacks.data(data),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "clearData", {
      value: () => this.callbacks.clearData(),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    return chainResult;
  }
}
