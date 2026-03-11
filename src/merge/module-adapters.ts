import { FilterEngine } from "../filter/filter";
import { TextSearchEngine } from "../search/text-search";
import { SortEngine } from "../sort/sorter";
import type { CollectionItem, FilterCriterion, SortDescriptor } from "../types";
import type {
  BaseModuleAdapter,
  EngineConstructor,
  MergeModuleName,
} from "./types";

export type SearchModuleAdapter<T extends CollectionItem> = BaseModuleAdapter<
  T,
  TextSearchEngine<T>
> & {
  moduleName: "search";
  executeSearch: (fieldOrQuery: string, maybeQuery?: string) => T[];
};

export type SortModuleAdapter<T extends CollectionItem> = BaseModuleAdapter<
  T,
  SortEngine<T>
> & {
  moduleName: "sort";
  executeSort: (
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace?: boolean,
  ) => T[];
};

export type FilterModuleAdapter<T extends CollectionItem> = BaseModuleAdapter<
  T,
  FilterEngine<T>
> & {
  moduleName: "filter";
  executeFilter: (
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ) => T[];
};

export type MergeModuleAdapter<T extends CollectionItem> =
  | SearchModuleAdapter<T>
  | SortModuleAdapter<T>
  | FilterModuleAdapter<T>;

export const getMergeModuleName = (
  EngineModule: EngineConstructor,
): MergeModuleName | null => {
  if (EngineModule === TextSearchEngine) {
    return "search";
  }

  if (EngineModule === SortEngine) {
    return "sort";
  }

  if (EngineModule === FilterEngine) {
    return "filter";
  }

  return null;
};

export const createMergeModuleAdapter = <T extends CollectionItem>(
  EngineModule: EngineConstructor,
  data: T[],
  config: Record<string, unknown>,
): MergeModuleAdapter<T> | null => {
  if (EngineModule === TextSearchEngine) {
    const engine = new TextSearchEngine<T>({ data, ...config });

    return {
      moduleName: "search",
      executeSearch: (fieldOrQuery, maybeQuery) =>
        maybeQuery === undefined
          ? engine.search(fieldOrQuery)
          : engine.search(
              fieldOrQuery as (keyof T & string) | (string & {}),
              maybeQuery,
            ),
      add: (items, appendToDataset = true) =>
        (engine as any).applyAddedItems(items, appendToDataset),
      clearIndexes: () => engine.clearIndexes(),
      clearData: () => engine.clearData(),
      data: (nextData) => engine.data(nextData),
      getOriginData: () => engine.getOriginData(),
    };
  }

  if (EngineModule === SortEngine) {
    const engine = new SortEngine<T>({ data, ...config });

    return {
      moduleName: "sort",
      executeSort: (dataOrDescriptors, descriptors, inPlace) =>
        descriptors === undefined
          ? engine.sort(dataOrDescriptors as SortDescriptor<T>[])
          : engine.sort(dataOrDescriptors as T[], descriptors, inPlace),
      add: (items, appendToDataset = true) =>
        (engine as any).applyAddedItems(items, appendToDataset),
      clearIndexes: () => engine.clearIndexes(),
      clearData: () => engine.clearData(),
      data: (nextData) => engine.data(nextData),
      getOriginData: () => engine.getOriginData(),
    };
  }

  if (EngineModule === FilterEngine) {
    const engine = new FilterEngine<T>({ data, ...config });

    return {
      moduleName: "filter",
      executeFilter: (dataOrCriteria, criteria) =>
        criteria === undefined
          ? engine.rawFilter(dataOrCriteria as FilterCriterion<T>[])
          : engine.rawFilter(dataOrCriteria as T[], criteria),
      add: (items, appendToDataset = true) =>
        (engine as any).applyAddedItems(items, appendToDataset),
      clearIndexes: () => engine.clearIndexes(),
      clearData: () => engine.clearData(),
      data: (nextData) => engine.data(nextData),
      getOriginData: () => engine.getOriginData(),
    };
  }

  return null;
};
