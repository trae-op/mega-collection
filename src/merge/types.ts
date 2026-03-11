import type { CollectionItem, FilterCriterion, SortDescriptor } from "../types";
import type { FilterEngineOptions } from "../filter/types";
import type { TextSearchEngineOptions } from "../search/types";
import type { SortEngineOptions } from "../sort/types";
import type { MergeEngines } from "./merge-engines";

export type MergeModuleName = "search" | "sort" | "filter";

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

  search?: TextSearchEngineOptions<T>;

  filter?: FilterEngineOptions<T>;

  sort?: SortEngineOptions<T>;

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

export type BaseModuleAdapter<T extends CollectionItem, TEngine> = {
  moduleName: MergeModuleName;
  add: (items: T[], appendToDataset?: boolean) => TEngine;
  clearIndexes: () => TEngine;
  clearData: () => TEngine;
  data: (data: T[]) => TEngine;
  getOriginData: () => T[];
};
