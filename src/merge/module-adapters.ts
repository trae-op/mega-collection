import type { CollectionItem } from "../types";
import type {
  EngineConstructor,
  MergeAppendableEngine,
  MergeModuleAdapter,
  MergeModuleName,
  MergeFilterEngine,
  MergeSearchEngine,
  MergeSortEngine,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasMethod<TName extends string>(
  value: unknown,
  methodName: TName,
): value is Record<TName, (...args: unknown[]) => unknown> {
  return isRecord(value) && typeof value[methodName] === "function";
}

function createAddAdapter<T extends CollectionItem>(
  engine: MergeAppendableEngine<T>,
): (items: T[], appendToDataset?: boolean) => unknown {
  return (items, appendToDataset = true) => {
    if (typeof engine.applyAddedItems === "function") {
      return engine.applyAddedItems(items, appendToDataset);
    }

    if (appendToDataset) {
      return engine.add(items);
    }

    return engine.data(engine.getOriginData());
  };
}

function isSearchEngine<T extends CollectionItem>(
  engine: unknown,
): engine is MergeSearchEngine<T> {
  return hasMethod(engine, "search") && hasMethod(engine, "getOriginData");
}

function isSortEngine<T extends CollectionItem>(
  engine: unknown,
): engine is MergeSortEngine<T> {
  return hasMethod(engine, "sort") && hasMethod(engine, "getOriginData");
}

function isFilterEngine<T extends CollectionItem>(
  engine: unknown,
): engine is MergeFilterEngine<T> {
  return hasMethod(engine, "rawFilter") && hasMethod(engine, "getOriginData");
}

export const resolveMergeModuleName = (
  EngineModule: EngineConstructor,
): MergeModuleName | null => {
  const { prototype } = EngineModule;

  if (isFilterEngine(prototype)) {
    return "filter";
  }

  if (isSortEngine(prototype)) {
    return "sort";
  }

  if (isSearchEngine(prototype)) {
    return "search";
  }

  return null;
};

export const createMergeModuleAdapter = <T extends CollectionItem>(
  EngineModule: EngineConstructor,
  data: T[],
  config: Record<string, unknown>,
): MergeModuleAdapter<T> | null => {
  const engine = new EngineModule({ data, ...config });

  if (isFilterEngine<T>(engine)) {
    return {
      moduleName: "filter",
      executeFilter: (dataOrCriteria, criteria) =>
        criteria === undefined
          ? engine.rawFilter(dataOrCriteria as any)
          : engine.rawFilter(dataOrCriteria as T[], criteria),
      add: createAddAdapter(engine),
      clearIndexes: () => engine.clearIndexes(),
      clearData: () => engine.clearData(),
      data: (nextData) => engine.data(nextData),
      getOriginData: () => engine.getOriginData(),
    };
  }

  if (isSortEngine<T>(engine)) {
    return {
      moduleName: "sort",
      executeSort: (dataOrDescriptors, descriptors, inPlace) =>
        descriptors === undefined
          ? engine.sort(dataOrDescriptors as any)
          : engine.sort(dataOrDescriptors as T[], descriptors, inPlace),
      add: createAddAdapter(engine),
      clearIndexes: () => engine.clearIndexes(),
      clearData: () => engine.clearData(),
      data: (nextData) => engine.data(nextData),
      getOriginData: () => engine.getOriginData(),
    };
  }

  if (isSearchEngine<T>(engine)) {
    return {
      moduleName: "search",
      executeSearch: (fieldOrQuery, maybeQuery) =>
        maybeQuery === undefined
          ? engine.search(fieldOrQuery)
          : engine.search(
              fieldOrQuery as (keyof T & string) | (string & {}),
              maybeQuery,
            ),
      add: createAddAdapter(engine),
      clearIndexes: () => engine.clearIndexes(),
      clearData: () => engine.clearData(),
      data: (nextData) => engine.data(nextData),
      getOriginData: () => engine.getOriginData(),
    };
  }

  return null;
};
