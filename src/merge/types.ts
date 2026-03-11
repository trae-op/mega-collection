import type { CollectionItem, FilterCriterion, SortDescriptor } from "../types";
import type { MergeEngines } from "./merge-engines";

export type MergeModuleName = "search" | "sort" | "filter";

export interface MergeSearchOptions<T extends CollectionItem = CollectionItem> {
  data?: T[];

  fields?: (keyof T & string)[];

  nestedFields?: string[];

  minQueryLength?: number;
}

export interface MergeSortOptions<T extends CollectionItem = CollectionItem> {
  data?: T[];

  fields?: (keyof T & string)[];
}

export interface MergeFilterOptions<T extends CollectionItem = CollectionItem> {
  data?: T[];

  mutableExcludeField?: keyof T & string;

  fields?: (keyof T & string)[];

  nestedFields?: string[];

  filterByPreviousResult?: boolean;
}

export interface MergeEnginesChain<T extends CollectionItem> {
  search(query: string): T[] & MergeEnginesChain<T>;
  search(
    field: (keyof T & string) | (string & {}),
    query: string,
  ): T[] & MergeEnginesChain<T>;
  sort(descriptors: SortDescriptor<T>[]): T[] & MergeEnginesChain<T>;
  sort(
    data: T[],
    descriptors: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] & MergeEnginesChain<T>;
  filter(criteria: FilterCriterion<T>[]): T[] & MergeEnginesChain<T>;
  filter(data: T[], criteria: FilterCriterion<T>[]): T[] & MergeEnginesChain<T>;
  getOriginData(): T[];
  add(items: T[]): MergeEngines<T>;
  data(data: T[]): MergeEngines<T>;
  clearIndexes(module: MergeModuleName): T[] & MergeEnginesChain<T>;
  clearData(module: MergeModuleName): T[] & MergeEnginesChain<T>;
}

export interface EngineConstructor {
  new (options: Record<string, unknown>): object;
  prototype: object;
  name: string;
}

export interface EngineApi {
  [methodName: string]: ((...args: unknown[]) => unknown) | undefined;
}

export interface MergeEnginesOptions<T extends CollectionItem> {
  imports: EngineConstructor[];

  data: T[];

  search?: MergeSearchOptions<T>;

  filter?: MergeFilterOptions<T>;

  sort?: MergeSortOptions<T>;

  [key: string]: unknown;
}

export type MergeEnginesChainCallbacks<T extends CollectionItem> = {
  search: (
    fieldOrQuery: string,
    maybeQuery?: string,
  ) => T[] & MergeEnginesChain<T>;
  sort: (
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace?: boolean,
  ) => T[] & MergeEnginesChain<T>;
  filter: (
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ) => T[] & MergeEnginesChain<T>;
  getOriginData: () => T[];
  add: (items: T[]) => MergeEngines<T>;
  data: (data: T[]) => MergeEngines<T>;
  clearIndexes: (module: MergeModuleName) => MergeEngines<T>;
  clearData: (module: MergeModuleName) => MergeEngines<T>;
};

export type BaseModuleAdapter<T extends CollectionItem> = {
  moduleName: MergeModuleName;
  add: (items: T[], appendToDataset?: boolean) => unknown;
  clearIndexes: () => unknown;
  clearData: () => unknown;
  data: (data: T[]) => unknown;
  getOriginData: () => T[];
};

export type SearchModuleAdapter<T extends CollectionItem> =
  BaseModuleAdapter<T> & {
    moduleName: "search";
    executeSearch: (fieldOrQuery: string, maybeQuery?: string) => T[];
  };

export type SortModuleAdapter<T extends CollectionItem> =
  BaseModuleAdapter<T> & {
    moduleName: "sort";
    executeSort: (
      dataOrDescriptors: T[] | SortDescriptor<T>[],
      descriptors?: SortDescriptor<T>[],
      inPlace?: boolean,
    ) => T[];
  };

export type FilterModuleAdapter<T extends CollectionItem> =
  BaseModuleAdapter<T> & {
    moduleName: "filter";
    executeFilter: (
      dataOrCriteria: T[] | FilterCriterion<T>[],
      criteria?: FilterCriterion<T>[],
    ) => T[];
  };

export interface MergeModuleAdapterMap<T extends CollectionItem> {
  search: SearchModuleAdapter<T>;
  sort: SortModuleAdapter<T>;
  filter: FilterModuleAdapter<T>;
}

export type MergeModuleAdapter<
  T extends CollectionItem,
  TModuleName extends MergeModuleName = MergeModuleName,
> = MergeModuleAdapterMap<T>[TModuleName];

export interface MergeBaseEngine<T extends CollectionItem> {
  add(items: T[]): unknown;
  clearIndexes(): unknown;
  clearData(): unknown;
  data(data: T[]): unknown;
  getOriginData(): T[];
}

export interface MergeAppendableEngine<
  T extends CollectionItem,
> extends MergeBaseEngine<T> {
  applyAddedItems?: (items: T[], appendToDataset: boolean) => unknown;
}

export interface MergeSearchEngine<
  T extends CollectionItem,
> extends MergeAppendableEngine<T> {
  search(query: string): T[];
  search(field: (keyof T & string) | (string & {}), query: string): T[];
}

export interface MergeSortEngine<
  T extends CollectionItem,
> extends MergeAppendableEngine<T> {
  sort(descriptors: SortDescriptor<T>[]): T[];
  sort(data: T[], descriptors: SortDescriptor<T>[], inPlace?: boolean): T[];
}

export interface MergeFilterEngine<
  T extends CollectionItem,
> extends MergeAppendableEngine<T> {
  rawFilter(criteria: FilterCriterion<T>[]): T[];
  rawFilter(data: T[], criteria: FilterCriterion<T>[]): T[];
}
