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
  isRecord,
  resolveMergeModuleName,
} from "./module-adapters";
import type {
  EngineConstructor,
  FilterModuleAdapter,
  MergeEnginesOptions,
  MergeModuleName,
  MergeSearchCache,
  MergeSortCache,
  SearchModuleAdapter,
  SortModuleAdapter,
} from "./types";
import { MergeEnginesError } from "./errors";

export class MergeEngines<T extends CollectionItem> {
  private readonly state: State<T>;

  private previousSearchState: MergeSearchCache<T> | null = null;

  private previousSortState: MergeSortCache<T> | null = null;

  private readonly searchModule: SearchModuleAdapter<T> | null;

  private readonly sortModule: SortModuleAdapter<T> | null;

  private readonly filterModule: FilterModuleAdapter<T> | null;

  private readonly chainBuilder: MergeEnginesChainBuilder<T>;

  /**
   * Creates a new MergeEngines instance with the given options.
   * Collects all modules from imports.
   */
  constructor(options: MergeEnginesOptions<T>) {
    const {
      imports,
      data,
      filterByPreviousResult = false,
      ...moduleOptions
    } = options;

    this.validateFilterByPreviousResultOptions(moduleOptions.filter);
    this.state = new State(data, { filterByPreviousResult });

    const importedEngines = new Set<EngineConstructor>(imports);
    let searchModule: SearchModuleAdapter<T> | null = null;
    let sortModule: SortModuleAdapter<T> | null = null;
    let filterModule: FilterModuleAdapter<T> | null = null;

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
    }

    this.searchModule = searchModule;
    this.sortModule = sortModule;
    this.filterModule = filterModule;

    this.chainBuilder = new MergeEnginesChainBuilder<T>({
      search: (fieldOrQuery, maybeQuery) => {
        if (maybeQuery === undefined) {
          return this.search(fieldOrQuery);
        }

        return this.search(
          fieldOrQuery as (keyof T & string) | (string & {}),
          maybeQuery,
        );
      },
      sort: (dataOrDescriptors, descriptors, inPlace) =>
        this.sort(dataOrDescriptors as T[], descriptors!, inPlace),
      filter: (dataOrCriteria, criteria) =>
        this.filter(dataOrCriteria as T[], criteria!),
      getOriginData: () => this.getOriginData(),
      add: (items) => this.add(items),
      update: (descriptor) => this.update(descriptor),
      data: (data) => this.data(data),
      clearIndexes: (module) => this.clearIndexes(module),
      clearData: (module) => this.clearData(module),
    });
  }

  private getAdapter(module: MergeModuleName) {
    if (module === "search") return this.searchModule;
    if (module === "sort") return this.sortModule;
    return this.filterModule;
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

      if (!isRecord(namedOptions)) {
        continue;
      }

      Object.assign(initOptions, namedOptions);
    }

    return initOptions;
  }

  private validateFilterByPreviousResultOptions(filterOptions: unknown): void {
    if (
      isRecord(filterOptions) &&
      Object.prototype.hasOwnProperty.call(
        filterOptions,
        "filterByPreviousResult",
      )
    ) {
      throw MergeEnginesError.invalidFilterByPreviousResultOption();
    }
  }

  private isPreviousResultEnabled(): boolean {
    return this.state.isFilterByPreviousResultEnabled();
  }

  private getPreviousResultInput(): T[] | null {
    if (!this.isPreviousResultEnabled()) {
      return null;
    }

    return this.state.getPreviousResult();
  }

  private trackPreviousResult(result: T[], sourceData: T[]): T[] {
    if (this.isPreviousResultEnabled()) {
      this.state.setPreviousResult(result, sourceData);
    }

    return result;
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
    const mutationVersion = this.state.getMutationVersion();
    const cacheKey = this.createSearchCacheKey(fieldOrQuery, maybeQuery);
    const previousSearchState = this.previousSearchState;

    if (
      previousSearchState?.originData === originData &&
      previousSearchState.key === cacheKey &&
      previousSearchState.version === mutationVersion
    ) {
      return this.withChain(
        this.trackPreviousResult(previousSearchState.result, originData),
      );
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
      version: mutationVersion,
    };

    return this.withChain(this.trackPreviousResult(result, originData));
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

    let sourceData: T[];
    let resolvedDescriptors: SortDescriptor<T>[];

    if (descriptors === undefined) {
      resolvedDescriptors = dataOrDescriptors as SortDescriptor<T>[];
      sourceData = this.getPreviousResultInput() ?? this.state.getOriginData();
    } else {
      sourceData = dataOrDescriptors as T[];
      resolvedDescriptors = descriptors;
    }

    if (!inPlace) {
      const mutationVersion = this.state.getMutationVersion();
      const cacheKey = this.createSortCacheKey(resolvedDescriptors, inPlace);
      const previousSortState = this.previousSortState;

      if (
        previousSortState?.sourceData === sourceData &&
        previousSortState.key === cacheKey &&
        previousSortState.version === mutationVersion
      ) {
        return this.withChain(
          this.trackPreviousResult(previousSortState.result, sourceData),
        );
      }

      const result =
        descriptors === undefined && sourceData === this.state.getOriginData()
          ? this.sortModule.executeSort(resolvedDescriptors)
          : this.sortModule.executeSort(
              sourceData,
              resolvedDescriptors,
              inPlace,
            );

      this.previousSortState = {
        key: cacheKey,
        sourceData,
        result,
        version: mutationVersion,
      };

      return this.withChain(this.trackPreviousResult(result, sourceData));
    }

    return this.withChain(
      this.trackPreviousResult(
        this.sortModule.executeSort(sourceData, resolvedDescriptors, inPlace),
        sourceData,
      ),
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
      const sourceData = this.getPreviousResultInput();
      const resolvedCriteria = dataOrCriteria as FilterCriterion<T>[];
      const result =
        sourceData === null
          ? this.filterModule.executeFilter(resolvedCriteria)
          : this.filterModule.executeFilter(sourceData, resolvedCriteria);

      return this.withChain(
        this.trackPreviousResult(
          result,
          sourceData ?? this.state.getOriginData(),
        ),
      );
    }

    const sourceData = dataOrCriteria as T[];
    return this.withChain(
      this.trackPreviousResult(
        this.filterModule.executeFilter(sourceData, criteria),
        sourceData,
      ),
    );
  }

  private withChain(result: T[]): T[] & MergeEnginesChain<T> {
    return this.chainBuilder.create(result);
  }

  getOriginData(): T[] {
    if (this.searchModule || this.sortModule || this.filterModule) {
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
    const adapter = this.getAdapter(module);

    if (adapter) {
      adapter.clearIndexes();
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
    if (this.getAdapter(module)) {
      this.state.clearData();
      this.clearOperationState();
      return this;
    }

    throw MergeEnginesError.unavailableEngine(module);
  }
}
