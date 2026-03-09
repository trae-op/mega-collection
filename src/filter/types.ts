import type { CollectionItem, FilterCriterion } from "../types";
import type { FilterEngine } from "./filter";

export interface FilterEngineChain<T extends CollectionItem> {
  filter(criteria: FilterCriterion<T>[]): T[] & FilterEngineChain<T>;
  filter(data: T[], criteria: FilterCriterion<T>[]): T[] & FilterEngineChain<T>;
  getOriginData(): T[];
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
  data: (data: T[]) => FilterEngine<T>;
  clearIndexes: () => FilterEngine<T>;
  clearData: () => FilterEngine<T>;
  resetFilterState: () => FilterEngine<T>;
};
