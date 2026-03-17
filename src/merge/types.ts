import type {
  CollectionItem,
  FilterCriterion,
  SortDescriptor,
  UpdateDescriptor,
} from "../types";
import type { MergeEngines } from "./merge-engines";

export type MergeModuleName = "search" | "sort" | "filter";

export interface MergeSearchOptions<T extends CollectionItem = CollectionItem> {
  data?: T[];

  fields?: (keyof T & string)[];

  nestedFields?: string[];

  minQueryLength?: number;

  filterByPreviousResult?: boolean;
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
  update(descriptor: UpdateDescriptor<T>): MergeEngines<T>;
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

  filterByPreviousResult?: boolean;

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
  update: (descriptor: UpdateDescriptor<T>) => MergeEngines<T>;
  data: (data: T[]) => MergeEngines<T>;
  clearIndexes: (module: MergeModuleName) => MergeEngines<T>;
  clearData: (module: MergeModuleName) => MergeEngines<T>;
};

export type BaseModuleAdapter = {
  moduleName: MergeModuleName;
  clearIndexes: () => unknown;
};

export type SearchModuleAdapter<T extends CollectionItem> =
  BaseModuleAdapter & {
    moduleName: "search";
    executeSearch: (fieldOrQuery: string, maybeQuery?: string) => T[];
  };

export type SortModuleAdapter<T extends CollectionItem> = BaseModuleAdapter & {
  moduleName: "sort";
  executeSort: (
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace?: boolean,
  ) => T[];
};

export type FilterModuleAdapter<T extends CollectionItem> =
  BaseModuleAdapter & {
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

export interface MergeBaseEngine {
  clearIndexes(): unknown;
}

export interface MergeSearchEngine<
  T extends CollectionItem,
> extends MergeBaseEngine {
  search(query: string): T[];
  search(field: (keyof T & string) | (string & {}), query: string): T[];
}

export interface MergeSortEngine<
  T extends CollectionItem,
> extends MergeBaseEngine {
  sort(descriptors: SortDescriptor<T>[]): T[];
  sort(data: T[], descriptors: SortDescriptor<T>[], inPlace?: boolean): T[];
}

export interface MergeFilterEngine<
  T extends CollectionItem,
> extends MergeBaseEngine {
  rawFilter(criteria: FilterCriterion<T>[]): T[];
  rawFilter(data: T[], criteria: FilterCriterion<T>[]): T[];
}

export type MergeSearchCache<T extends CollectionItem> = {
  key: string;
  originData: T[];
  result: T[];
  version: number;
};

export type MergeSortCache<T extends CollectionItem> = {
  key: string;
  sourceData: T[];
  result: T[];
  version: number;
  descriptors: SortDescriptor<T>[];
};
