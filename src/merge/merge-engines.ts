/**
 * MergeEngines class that provides a unified interface for text search,
 * sorting, and filtering operations on collections.
 */

import type { CollectionItem, FilterCriterion, SortDescriptor } from "../types";
import { MergeEnginesChain, MergeEnginesChainBuilder } from "./chain";
import {
  createMergeModuleAdapter,
  getMergeModuleName,
} from "./module-adapters";
import type {
  FilterModuleAdapter,
  SearchModuleAdapter,
  SortModuleAdapter,
} from "./module-adapters";
import type {
  EngineConstructor,
  MergeEnginesOptions,
  MergeModuleName,
} from "./types";
import { MergeEnginesError } from "./errors";

export class MergeEngines<T extends CollectionItem> {
  private readonly searchModule: SearchModuleAdapter<T> | null;

  private readonly sortModule: SortModuleAdapter<T> | null;

  private readonly filterModule: FilterModuleAdapter<T> | null;

  private readonly clearIndexMethods: Partial<
    Record<MergeModuleName, () => unknown>
  >;

  private readonly clearDataMethods: Partial<
    Record<MergeModuleName, () => unknown>
  >;

  private readonly addMethods: Partial<
    Record<MergeModuleName, (items: T[], appendToDataset?: boolean) => unknown>
  >;

  private readonly getOriginDataMethods: Partial<
    Record<MergeModuleName, () => T[]>
  >;

  private readonly setDataMethods: Partial<
    Record<MergeModuleName, (data: T[]) => unknown>
  >;

  private readonly getOriginDataMethod: (() => T[]) | null;

  private previousSearchState: {
    key: string;
    originData: T[];
    result: T[];
  } | null = null;

  private previousSortState: {
    key: string;
    sourceData: T[];
    result: T[];
  } | null = null;

  private readonly chainBuilder = new MergeEnginesChainBuilder<T>({
    search: (fieldOrQuery, maybeQuery) => {
      if (maybeQuery === undefined) {
        return this.search(fieldOrQuery);
      }

      return this.search(
        fieldOrQuery as (keyof T & string) | (string & {}),
        maybeQuery,
      );
    },
    sort: (dataOrDescriptors, descriptors, inPlace) => {
      if (descriptors === undefined) {
        return this.sort(dataOrDescriptors as SortDescriptor<T>[]);
      }

      return this.sort(dataOrDescriptors as T[], descriptors, inPlace);
    },
    filter: (dataOrCriteria, criteria) => {
      if (criteria === undefined) {
        return this.filter(dataOrCriteria as FilterCriterion<T>[]);
      }

      return this.filter(dataOrCriteria as T[], criteria);
    },
    getOriginData: () => this.getOriginData(),
    add: (items) => this.add(items),
    data: (data) => this.data(data),
    clearIndexes: (module) => this.clearIndexes(module),
    clearData: (module) => this.clearData(module),
  });

  /**
   * Creates a new MergeEngines instance with the given options.
   * Collects all modules from imports.
   */
  constructor(options: MergeEnginesOptions<T>) {
    const { imports, data, ...moduleOptions } = options;

    const importedEngines = new Set<EngineConstructor>(imports);
    let searchModule: SearchModuleAdapter<T> | null = null;
    let sortModule: SortModuleAdapter<T> | null = null;
    let filterModule: FilterModuleAdapter<T> | null = null;
    const clearIndexMethods: Partial<Record<MergeModuleName, () => unknown>> =
      {};
    const clearDataMethods: Partial<Record<MergeModuleName, () => unknown>> =
      {};
    const addMethods: Partial<
      Record<
        MergeModuleName,
        (items: T[], appendToDataset?: boolean) => unknown
      >
    > = {};
    const getOriginDataMethods: Partial<Record<MergeModuleName, () => T[]>> =
      {};
    const setDataMethods: Partial<
      Record<MergeModuleName, (data: T[]) => unknown>
    > = {};
    let getOriginDataMethod: (() => T[]) | null = null;

    for (const EngineModule of importedEngines) {
      const moduleName = getMergeModuleName(EngineModule);
      if (!moduleName) {
        continue;
      }

      const currentModuleOptions = this.getModuleInitOptions(
        moduleName,
        EngineModule.name,
        moduleOptions,
      );

      const moduleAdapter = createMergeModuleAdapter<T>(
        EngineModule,
        data,
        currentModuleOptions,
      );

      if (!moduleAdapter) {
        continue;
      }

      if (moduleAdapter.moduleName === "search" && !searchModule) {
        searchModule = moduleAdapter;
      }

      if (moduleAdapter.moduleName === "sort" && !sortModule) {
        sortModule = moduleAdapter;
      }

      if (moduleAdapter.moduleName === "filter" && !filterModule) {
        filterModule = moduleAdapter;
      }

      clearIndexMethods[moduleAdapter.moduleName] = () =>
        moduleAdapter.clearIndexes();
      clearDataMethods[moduleAdapter.moduleName] = () =>
        moduleAdapter.clearData();
      addMethods[moduleAdapter.moduleName] = (items, appendToDataset) =>
        moduleAdapter.add(items, appendToDataset);
      getOriginDataMethods[moduleAdapter.moduleName] = () =>
        moduleAdapter.getOriginData();
      setDataMethods[moduleAdapter.moduleName] = (nextData) =>
        moduleAdapter.data(nextData);
      getOriginDataMethod ??= () => moduleAdapter.getOriginData();
    }

    this.searchModule = searchModule;
    this.sortModule = sortModule;
    this.filterModule = filterModule;
    this.clearIndexMethods = clearIndexMethods;
    this.clearDataMethods = clearDataMethods;
    this.addMethods = addMethods;
    this.getOriginDataMethods = getOriginDataMethods;
    this.setDataMethods = setDataMethods;
    this.getOriginDataMethod = getOriginDataMethod;
  }

  /**
   * Gets the initialization options for a module.
   */
  private getModuleInitOptions(
    moduleName: MergeModuleName,
    engineName: string,
    options: Record<string, unknown>,
  ): Record<string, unknown> {
    const initOptions: Record<string, unknown> = {};

    for (const optionKey of [moduleName, engineName]) {
      const namedOptions = options[optionKey];

      if (!this.isRecord(namedOptions)) {
        continue;
      }

      Object.assign(initOptions, namedOptions);
    }

    return initOptions;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private clearOperationState(module?: MergeModuleName): void {
    if (!module || module === "search") {
      this.previousSearchState = null;
    }

    if (!module || module === "sort") {
      this.previousSortState = null;
    }
  }

  private createSearchCacheKey(
    fieldOrQuery: string,
    maybeQuery?: string,
  ): string {
    return JSON.stringify([fieldOrQuery, maybeQuery ?? null]);
  }

  private createSortCacheKey(
    descriptors: SortDescriptor<T>[],
    inPlace?: boolean,
  ): string {
    return JSON.stringify({ descriptors, inPlace: inPlace ?? false });
  }

  search(query: string): T[] & MergeEnginesChain<T>;
  search(
    field: (keyof T & string) | (string & {}),
    query: string,
  ): T[] & MergeEnginesChain<T>;
  search(
    fieldOrQuery: string,
    maybeQuery?: string,
  ): T[] & MergeEnginesChain<T> {
    if (!this.searchModule) {
      throw MergeEnginesError.unavailableEngine("search");
    }

    const originData = this.searchModule.getOriginData();
    const cacheKey = this.createSearchCacheKey(fieldOrQuery, maybeQuery);

    if (
      this.previousSearchState?.originData === originData &&
      this.previousSearchState.key === cacheKey
    ) {
      return this.withChain(this.previousSearchState.result);
    }

    let result: T[];

    if (maybeQuery === undefined) {
      result = this.searchModule.executeSearch(fieldOrQuery);
    } else {
      result = this.searchModule.executeSearch(
        fieldOrQuery as (keyof T & string) | (string & {}),
        maybeQuery,
      );
    }

    this.previousSearchState = {
      key: cacheKey,
      originData,
      result,
    };

    return this.withChain(result);
  }

  sort(descriptors: SortDescriptor<T>[]): T[] & MergeEnginesChain<T>;
  sort(
    data: T[],
    descriptors: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] & MergeEnginesChain<T>;
  sort(
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] & MergeEnginesChain<T> {
    if (!this.sortModule) {
      throw MergeEnginesError.unavailableEngine("sort");
    }

    if (descriptors === undefined) {
      return this.withChain(
        this.sortModule.executeSort(dataOrDescriptors as SortDescriptor<T>[]),
      );
    }

    const sourceData = dataOrDescriptors as T[];

    if (!inPlace) {
      const cacheKey = this.createSortCacheKey(descriptors, inPlace);

      if (
        this.previousSortState?.sourceData === sourceData &&
        this.previousSortState.key === cacheKey
      ) {
        return this.withChain(this.previousSortState.result);
      }

      const result = this.sortModule.executeSort(
        sourceData,
        descriptors,
        inPlace,
      );

      this.previousSortState = {
        key: cacheKey,
        sourceData,
        result,
      };

      return this.withChain(result);
    }

    return this.withChain(
      this.sortModule.executeSort(sourceData, descriptors, inPlace),
    );
  }

  filter(criteria: FilterCriterion<T>[]): T[] & MergeEnginesChain<T>;
  filter(data: T[], criteria: FilterCriterion<T>[]): T[] & MergeEnginesChain<T>;
  filter(
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ): T[] & MergeEnginesChain<T> {
    if (!this.filterModule) {
      throw MergeEnginesError.unavailableEngine("filter");
    }

    if (criteria === undefined) {
      return this.withChain(
        this.filterModule.executeFilter(dataOrCriteria as FilterCriterion<T>[]),
      );
    }

    return this.withChain(
      this.filterModule.executeFilter(dataOrCriteria as T[], criteria),
    );
  }

  private withChain(result: T[]): T[] & MergeEnginesChain<T> {
    return this.chainBuilder.create(result);
  }

  getOriginData(): T[] {
    if (this.getOriginDataMethod) {
      return this.getOriginDataMethod();
    }

    throw MergeEnginesError.unavailableGetOriginData();
  }

  add(items: T[]): this {
    if (items.length === 0) {
      return this;
    }

    const moduleNames: MergeModuleName[] = ["search", "sort", "filter"];
    const appendedDatasets = new Set<T[]>();

    this.clearOperationState();

    for (const moduleName of moduleNames) {
      const addMethod = this.addMethods[moduleName];
      const getOriginDataMethod = this.getOriginDataMethods[moduleName];
      if (!addMethod) {
        continue;
      }

      const currentDataset = getOriginDataMethod?.();
      const appendToDataset =
        currentDataset === undefined || !appendedDatasets.has(currentDataset);

      addMethod(items, appendToDataset);

      if (currentDataset !== undefined) {
        appendedDatasets.add(currentDataset);
      }
    }

    return this;
  }

  clearIndexes(module: MergeModuleName): this {
    const clearMethod = this.clearIndexMethods[module];

    if (clearMethod) {
      clearMethod();
      this.clearOperationState(module);
      return this;
    }

    throw MergeEnginesError.unavailableEngine(module);
  }

  data(data: T[]): this {
    const moduleNames: MergeModuleName[] = ["search", "sort", "filter"];

    this.clearOperationState();

    for (const moduleName of moduleNames) {
      const setDataMethod = this.setDataMethods[moduleName];
      if (!setDataMethod) continue;
      setDataMethod(data);
    }

    return this;
  }

  clearData(module: MergeModuleName): this {
    const clearMethod = this.clearDataMethods[module];

    if (clearMethod) {
      clearMethod();
      this.clearOperationState(module);
      return this;
    }

    throw MergeEnginesError.unavailableEngine(module);
  }
}
