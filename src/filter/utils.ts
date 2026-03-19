import type { CollectionItem } from "../types";
import type { FilterRuntime, FilterSequentialCacheEntry } from "./types";

export const createFilterRuntime = <
  T extends CollectionItem,
>(): FilterRuntime<T> => ({
  indexedFields: new Set<keyof T & string>(),
  indexerStorage: {
    indexes: new Map<string, Map<any, T[]>>(),
    itemPositions: new Map<string, Map<any, WeakMap<T, number>>>(),
  },
  nestedStorage: {
    indexes: new Map<string, Map<any, T[]>>(),
    itemPositions: new Map<string, Map<any, WeakMap<T, number>>>(),
  },
  deferredMutationVersion: null,
  sequentialCache: {
    previousResult: null,
    previousCriteria: null,
    previousCriteriaKey: null,
    previousBaseData: null,
    previousResultsByCriteria: new Map<string, FilterSequentialCacheEntry<T>>(),
    previousResultSet: null,
  },
});
