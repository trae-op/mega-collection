/**
 * MergeEngines class that provides a unified interface for text search,
 * sorting, and filtering operations on collections.
 */

import { State } from "../State";
import type {
  CollectionItem,
  FilterCriterion,
  SortDescriptor,
  UpdateDescriptor,
} from "../types";
import { MergeEnginesChain, MergeEnginesChainBuilder } from "./chain";
import {
  createMergeModuleAdapter,
  resolveMergeModuleName,
} from "./module-adapters";
import type {
  EngineConstructor,
  FilterModuleAdapter,
  MergeEnginesOptions,
  MergeModuleName,
  SearchModuleAdapter,
  SortModuleAdapter,
} from "./types";
import { MergeEnginesError } from "./errors";

export class MergeEngines<T extends CollectionItem> {
  private readonly state: State<T>;

  private readonly searchModule: SearchModuleAdapter<T> | null;

  private readonly sortModule: SortModuleAdapter<T> | null;

  private readonly filterModule: FilterModuleAdapter<T> | null;

  private readonly clearIndexMethods: Partial<
    Record<MergeModuleName, () => unknown>
  >;

  private readonly importedModules = new Set<MergeModuleName>();

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
    update: (descriptor) => this.update(descriptor),
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
    this.state = new State(data);

    const importedEngines = new Set<EngineConstructor>(imports);
    let searchModule: SearchModuleAdapter<T> | null = null;
    let sortModule: SortModuleAdapter<T> | null = null;
    let filterModule: FilterModuleAdapter<T> | null = null;
    const clearIndexMethods: Partial<Record<MergeModuleName, () => unknown>> =
      {};

    for (const EngineModule of importedEngines) {
      const moduleName = resolveMergeModuleName(EngineModule);

      if (!moduleName) {
        continue;
      }

      const currentModuleOptions = this.getModuleInitOptions(
        moduleName,
        EngineModule.name,
        moduleOptions,
      );

      const configuredModuleAdapter = createMergeModuleAdapter<T>(
        EngineModule,
        data,
        this.state,
        currentModuleOptions,
      );

      if (!configuredModuleAdapter) {
        continue;
      }

      if (configuredModuleAdapter.moduleName === "search" && !searchModule) {
        searchModule = configuredModuleAdapter;
      }

      if (configuredModuleAdapter.moduleName === "sort" && !sortModule) {
        sortModule = configuredModuleAdapter;
      }

      if (configuredModuleAdapter.moduleName === "filter" && !filterModule) {
        filterModule = configuredModuleAdapter;
      }

      this.importedModules.add(configuredModuleAdapter.moduleName);
      clearIndexMethods[configuredModuleAdapter.moduleName] = () =>
        configuredModuleAdapter.clearIndexes();
    }

    this.searchModule = searchModule;
    this.sortModule = sortModule;
    this.filterModule = filterModule;
    this.clearIndexMethods = clearIndexMethods;
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

    const originData = this.state.getOriginData();
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
    if (this.importedModules.size > 0) {
      return this.state.getOriginData();
    }

    throw MergeEnginesError.unavailableGetOriginData();
  }

  add(items: T[]): this {
    if (items.length === 0) {
      return this;
    }

    this.clearOperationState();
    this.state.add(items);

    return this;
  }

  update(descriptor: UpdateDescriptor<T>): this {
    this.clearOperationState();
    this.state.update(descriptor);
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
    this.clearOperationState();
    this.state.data(data);

    return this;
  }

  clearData(module: MergeModuleName): this {
    if (this.importedModules.has(module)) {
      this.state.clearData();
      this.clearOperationState(module);
      return this;
    }

    throw MergeEnginesError.unavailableEngine(module);
  }
}
