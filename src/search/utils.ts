import type { CollectionItem } from "../types";
import type { SearchIndex, SearchRuntime } from "./types";

export const createSearchRuntime = <
  T extends CollectionItem,
>(): SearchRuntime<T> => ({
  indexedFields: new Set<keyof T & string>(),
  flatIndexes: new Map<string, SearchIndex>(),
  nestedStorage: {
    ngramIndexes: new Map<string, Map<string, Set<number>>>(),
    normalizedFieldValues: new Map<string, string[]>(),
  },
  deferredMutationVersion: null,
  filterByPreviousResult: false,
  previousResultIndices: null,
  previousResultLookup: null,
  previousQuery: null,
  stats: {
    totalQueries: 0,
    indexedQueries: 0,
    fallbackQueries: 0,
    fallbackFields: new Map<string, number>(),
  },
});
