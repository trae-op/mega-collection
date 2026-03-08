import type { CollectionItem } from "../types";
import type { TextSearchEngine } from "./text-search";

export interface TextSearchEngineOptions<
  T extends CollectionItem = CollectionItem,
> {
  data?: T[];

  fields?: (keyof T & string)[];

  nestedFields?: string[];

  minQueryLength?: number;
}

export interface TextSearchEngineChain<T extends CollectionItem> {
  search(query: string): T[] & TextSearchEngineChain<T>;
  search(
    field: (keyof T & string) | (string & {}),
    query: string,
  ): T[] & TextSearchEngineChain<T>;
  getOriginData(): T[];
  data(data: T[]): TextSearchEngine<T>;
  clearIndexes(): TextSearchEngine<T>;
  clearData(): TextSearchEngine<T>;
}

export type TextSearchEngineChainCallbacks<T extends CollectionItem> = {
  search: (
    fieldOrQuery: string,
    maybeQuery?: string,
  ) => T[] & TextSearchEngineChain<T>;
  getOriginData: () => T[];
  data: (data: T[]) => TextSearchEngine<T>;
  clearIndexes: () => TextSearchEngine<T>;
  clearData: () => TextSearchEngine<T>;
};

export type NestedFieldDescriptor = {
  collectionKey: string;
  nestedKey: string;
};
