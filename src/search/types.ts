import type { CollectionItem } from "../types";

export interface TextSearchEngineOptions<
  T extends CollectionItem = CollectionItem,
> {
  data?: T[];

  fields?: (keyof T & string)[];

  nestedFields?: string[];

  /**
   * Minimum query length required to trigger a search. Defaults to `1`.
   *
   * Queries shorter than the trigram length (3) always use a linear scan even
   * when an index is configured, because the index only stores trigrams. Set
   * `minQueryLength` to `3` or higher to skip sub-trigram queries entirely and
   * guarantee that every accepted query hits the index.
   */
  minQueryLength?: number;

  /**
   * When `true`, each search narrows its source to the previous result if the
   * new query includes the previous query as a prefix/substring. Useful for
   * search-as-you-type scenarios where the user incrementally refines the query.
   *
   * Call {@link TextSearchEngine.resetSearchState} to discard the saved result
   * and force the next search to scan the full dataset.
   */
  filterByPreviousResult?: boolean;
}

export type NestedFieldDescriptor = {
  collectionKey: string;
  nestedKey: string;
};

export type SearchIndex = {
  ngramMap: Map<string, Set<number>>;
  normalizedValues: string[];
  version: number;
};

export interface SearchNestedCollectionStorage {
  ngramIndexes: Map<string, Map<string, Set<number>>>;
  normalizedFieldValues: Map<string, string[]>;
}

export type SearchRuntime<T extends CollectionItem> = {
  indexedFields: Set<keyof T & string>;
  flatIndexes: Map<string, SearchIndex>;
  nestedStorage: SearchNestedCollectionStorage;
  filterByPreviousResult: boolean;
  previousResult: T[] | null;
  previousResultIndices: number[] | null;
  previousQuery: string | null;
};
