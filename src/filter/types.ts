import type { IndexerStorage } from "../indexer";
import type { CollectionItem, FilterCriterion } from "../types";
import type { ResolvedFilterCriterion } from "./criterion";
import type { FilterEngine } from "./filter";
import type { FilterNestedCollectionStorage } from "./nested";

export interface FilterEngineChain<T extends CollectionItem> {
  filter(criteria: FilterCriterion<T>[]): T[] & FilterEngineChain<T>;
  filter(data: T[], criteria: FilterCriterion<T>[]): T[] & FilterEngineChain<T>;
  getOriginData(): T[];
  add(items: T[]): FilterEngine<T>;
  update(descriptor: import("../types").UpdateDescriptor<T>): FilterEngine<T>;
  data(data: T[]): FilterEngine<T>;
  clearIndexes(): FilterEngine<T>;
  clearData(): FilterEngine<T>;
  resetFilterState(): FilterEngine<T>;
}

export interface FilterEngineOptions<
  T extends CollectionItem = CollectionItem,
> {
  data?: T[];

  mutableExcludeField?: keyof T & string;

  fields?: (keyof T & string)[];

  nestedFields?: string[];

  filterByPreviousResult?: boolean;
}

export type NestedFieldDescriptor = {
  collectionKey: string;
  nestedKey: string;
};

export type FilterEngineChainCallbacks<T extends CollectionItem> = {
  filter: (
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ) => T[] & FilterEngineChain<T>;
  getOriginData: () => T[];
  add: (items: T[]) => FilterEngine<T>;
  update: (
    descriptor: import("../types").UpdateDescriptor<T>,
  ) => FilterEngine<T>;
  data: (data: T[]) => FilterEngine<T>;
  clearIndexes: () => FilterEngine<T>;
  clearData: () => FilterEngine<T>;
  resetFilterState: () => FilterEngine<T>;
};

export type FilterSequentialCache<T extends CollectionItem> = {
  previousResult: T[] | null;
  previousCriteria: ResolvedFilterCriterion<T>[] | null;
  previousBaseData: T[] | null;
  previousResultsByCriteria: Map<string, T[]>;
};

export type MutableExcludeRuntime = {
  datasetPositions: Map<any, number>;
  valueCounts: Map<any, number>;
  duplicateValueCount: number;
  hasDuplicateValues: boolean;
};

export type FilterRuntime<T extends CollectionItem> = {
  indexedFields: Set<keyof T & string>;
  indexerStorage: IndexerStorage<T>;
  nestedStorage: FilterNestedCollectionStorage<T>;
  mutableExclude: MutableExcludeRuntime;
  sequentialCache: FilterSequentialCache<T>;
};
