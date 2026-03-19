/**
 * MergeEngines class that provides a unified interface for text search,
 * sorting, and filtering operations on collections.
 */

import { State } from "../State";
import type {
  CollectionItem,
  FilterCriterion,
  IndexableKey,
  StateMutation,
  SortDescriptor,
  UpdateDescriptor,
} from "../types";
import {
  createNonUniqueDeleteErrorMessage,
  findDuplicateDeleteValues,
  normalizeDeleteValues,
} from "../internal";
import { MergeEnginesChain, MergeEnginesChainBuilder } from "./chain";
import {
  createMergeModuleAdapter,
  isRecord,
  resolveMergeModuleName,
} from "./module-adapters";
import type {
  EngineConstructor,
  MergeFilterCache,
  FilterModuleAdapter,
  MergeEnginesOptions,
  MergeModuleName,
  MergeSearchCache,
  MergeSortCache,
  SearchModuleAdapter,
  SortModuleAdapter,
} from "./types";
import { MergeEnginesError } from "./errors";
import {
  DEFER_FILTER_MUTATION_INDEX_UPDATES_KEY,
  DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY,
  DEFER_SORT_MUTATION_CACHE_UPDATES_KEY,
  MERGE_SHARED_SCOPE,
} from "../constants";

export class MergeEngines<T extends CollectionItem> {
  private readonly state: State<T>;

  private previousSearchState: MergeSearchCache<T> | null = null;

  private previousFilterState: MergeFilterCache<T> | null = null;

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

    if (this.sortModule) {
      this.state.setScopedValue(
        MERGE_SHARED_SCOPE,
        DEFER_SORT_MUTATION_CACHE_UPDATES_KEY,
        true,
      );
    }

    if (this.searchModule) {
      this.state.setScopedValue(
        MERGE_SHARED_SCOPE,
        DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY,
        true,
      );
    }

    if (this.filterModule) {
      this.state.setScopedValue(
        MERGE_SHARED_SCOPE,
        DEFER_FILTER_MUTATION_INDEX_UPDATES_KEY,
        true,
      );
    }

    this.state.subscribe((mutation) => this.handleStateMutation(mutation));

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
      delete: (field, valueOrValues) => this.delete(field, valueOrValues),
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

    if (!module || module === "filter") {
      this.previousFilterState = null;
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

  private createFilterCacheKey(criteria: FilterCriterion<T>[]): string {
    return JSON.stringify(criteria);
  }

  private handleStateMutation(mutation: StateMutation<T>): void {
    switch (mutation.type) {
      case "add":
        this.queueSearchCacheMutation(mutation);
        this.queueFilterCacheMutation(mutation);
        this.queueSortCacheMutation(mutation);
        return;
      case "update":
        this.queueSearchCacheMutation(mutation);
        this.queueFilterCacheMutation(mutation);
        this.queueSortCacheMutation(mutation);
        return;
      case "remove":
        this.previousSearchState = null;
        this.previousFilterState = null;
        this.queueSortCacheMutation(mutation);
        return;
      case "removeMany":
        this.previousSearchState = null;
        this.previousFilterState = null;
        this.queueSortCacheMutation(mutation);
        return;
      case "data":
      case "clearData":
        this.previousSearchState = null;
        this.previousFilterState = null;
        this.previousSortState = null;
        return;
    }
  }

  private queueSearchCacheMutation(mutation: StateMutation<T>): void {
    const previousSearchState = this.previousSearchState;

    if (previousSearchState === null) {
      return;
    }

    if (!this.canPatchStoredDatasetSearch(previousSearchState)) {
      this.previousSearchState = null;
      return;
    }

    this.previousSearchState = {
      ...previousSearchState,
      version: this.state.getMutationVersion(),
      pendingMutations: previousSearchState.pendingMutations.concat(mutation),
    };
  }

  private queueFilterCacheMutation(mutation: StateMutation<T>): void {
    const previousFilterState = this.previousFilterState;

    if (previousFilterState === null) {
      return;
    }

    if (!this.canPatchStoredDatasetFilter(previousFilterState)) {
      this.previousFilterState = null;
      return;
    }

    this.previousFilterState = {
      ...previousFilterState,
      version: this.state.getMutationVersion(),
      pendingMutations: previousFilterState.pendingMutations.concat(mutation),
    };
  }

  private queueSortCacheMutation(mutation: StateMutation<T>): void {
    const previousSortState = this.previousSortState;

    if (previousSortState === null) {
      return;
    }

    if (!this.canPatchStoredDatasetSort(previousSortState)) {
      this.previousSortState = null;
      return;
    }

    this.previousSortState = {
      ...previousSortState,
      version: this.state.getMutationVersion(),
      pendingMutations: previousSortState.pendingMutations.concat(mutation),
    };
  }

  private resolvePendingSortCache(
    cache: MergeSortCache<T>,
  ): MergeSortCache<T> | null {
    if (cache.pendingMutations.length === 0) {
      return cache;
    }

    let nextCache: MergeSortCache<T> | null = {
      ...cache,
      pendingMutations: [],
    };

    for (
      let mutationIndex = 0;
      mutationIndex < cache.pendingMutations.length;
      mutationIndex++
    ) {
      nextCache = this.applySortCacheMutation(
        nextCache,
        cache.pendingMutations[mutationIndex],
      );

      if (nextCache === null) {
        return null;
      }
    }

    return nextCache;
  }

  private resolvePendingSearchCache(
    cache: MergeSearchCache<T>,
  ): MergeSearchCache<T> | null {
    if (cache.pendingMutations.length === 0) {
      return cache;
    }

    let nextCache: MergeSearchCache<T> | null = {
      ...cache,
      pendingMutations: [],
    };

    for (
      let mutationIndex = 0;
      mutationIndex < cache.pendingMutations.length;
      mutationIndex++
    ) {
      nextCache = this.applySearchCacheMutation(
        nextCache,
        cache.pendingMutations[mutationIndex],
      );

      if (nextCache === null) {
        return null;
      }
    }

    return nextCache;
  }

  private resolvePendingFilterCache(
    cache: MergeFilterCache<T>,
  ): MergeFilterCache<T> | null {
    if (cache.pendingMutations.length === 0) {
      return cache;
    }

    let nextCache: MergeFilterCache<T> | null = {
      ...cache,
      pendingMutations: [],
    };

    for (
      let mutationIndex = 0;
      mutationIndex < cache.pendingMutations.length;
      mutationIndex++
    ) {
      nextCache = this.applyFilterCacheMutation(
        nextCache,
        cache.pendingMutations[mutationIndex],
      );

      if (nextCache === null) {
        return null;
      }
    }

    return nextCache;
  }

  private applySortCacheMutation(
    cache: MergeSortCache<T>,
    mutation: StateMutation<T>,
  ): MergeSortCache<T> | null {
    switch (mutation.type) {
      case "add":
        return this.patchSortCacheForAddedItems(cache, mutation.items);
      case "update":
        return this.patchSortCacheForUpdatedItem(
          cache,
          mutation.previousItem,
          mutation.nextItem,
        );
      case "remove":
        return this.patchSortCacheForRemovedItems(cache, [
          mutation.removedItem,
        ]);
      case "removeMany":
        return this.patchSortCacheForRemovedItems(
          cache,
          mutation.entries.map((entry) => entry.removedItem),
        );
      case "data":
      case "clearData":
        return null;
    }
  }

  private applySearchCacheMutation(
    cache: MergeSearchCache<T>,
    mutation: StateMutation<T>,
  ): MergeSearchCache<T> | null {
    switch (mutation.type) {
      case "add":
        return this.patchSearchCacheForAddedItems(cache, mutation.items);
      case "update":
        return this.patchSearchCacheForUpdatedItem(
          cache,
          mutation.previousItem,
          mutation.nextItem,
        );
      case "remove":
      case "removeMany":
      case "data":
      case "clearData":
        return null;
    }
  }

  private applyFilterCacheMutation(
    cache: MergeFilterCache<T>,
    mutation: StateMutation<T>,
  ): MergeFilterCache<T> | null {
    switch (mutation.type) {
      case "add":
        return this.patchFilterCacheForAddedItems(cache, mutation.items);
      case "update":
        return this.patchFilterCacheForUpdatedItem(
          cache,
          mutation.previousItem,
          mutation.nextItem,
        );
      case "remove":
      case "removeMany":
      case "data":
      case "clearData":
        return null;
    }
  }

  private canPatchStoredDatasetSearch(cache: MergeSearchCache<T>): boolean {
    return (
      cache.originData === this.state.getOriginData() && cache.field !== null
    );
  }

  private canPatchStoredDatasetFilter(cache: MergeFilterCache<T>): boolean {
    if (cache.sourceData !== this.state.getOriginData()) {
      return false;
    }

    for (let index = 0; index < cache.criteria.length; index++) {
      if (!this.isPatchableFilterCriterion(cache.criteria[index])) {
        return false;
      }
    }

    return true;
  }

  private canPatchStoredDatasetSort(cache: MergeSortCache<T>): boolean {
    return cache.sourceData === this.state.getOriginData();
  }

  private compareItemsByDescriptors(
    left: T,
    right: T,
    descriptors: SortDescriptor<T>[],
  ): number {
    for (let index = 0; index < descriptors.length; index++) {
      const { field, direction } = descriptors[index];
      const leftValue = left[field];
      const rightValue = right[field];

      if (leftValue < rightValue) {
        return direction === "asc" ? -1 : 1;
      }

      if (leftValue > rightValue) {
        return direction === "asc" ? 1 : -1;
      }
    }

    return (
      (this.state.getItemIndex(left) ?? -1) -
      (this.state.getItemIndex(right) ?? -1)
    );
  }

  private findSortInsertPosition(
    items: T[],
    candidate: T,
    descriptors: SortDescriptor<T>[],
  ): number {
    let low = 0;
    let high = items.length;

    while (low < high) {
      const middle = (low + high) >> 1;
      const comparison = this.compareItemsByDescriptors(
        items[middle],
        candidate,
        descriptors,
      );

      if (comparison <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }

  private findDatasetInsertPosition(items: T[], candidate: T): number {
    const candidateIndex =
      this.state.getItemIndex(candidate) ?? Number.MAX_SAFE_INTEGER;

    for (let index = 0; index < items.length; index++) {
      const itemIndex =
        this.state.getItemIndex(items[index]) ?? Number.MAX_SAFE_INTEGER;

      if (itemIndex > candidateIndex) {
        return index;
      }
    }

    return items.length;
  }

  private doesItemMatchSearchCache(
    cache: MergeSearchCache<T>,
    item: T,
  ): boolean {
    if (cache.field === null || cache.lowerQuery.length === 0) {
      return false;
    }

    const value = item[cache.field as keyof T];
    return (
      typeof value === "string" &&
      value.toLowerCase().includes(cache.lowerQuery)
    );
  }

  private patchSearchCacheForAddedItems(
    cache: MergeSearchCache<T>,
    items: T[],
  ): MergeSearchCache<T> | null {
    if (!this.canPatchStoredDatasetSearch(cache)) {
      return null;
    }

    const nextResult = cache.result.slice();

    for (let index = 0; index < items.length; index++) {
      const candidate = items[index];

      if (this.doesItemMatchSearchCache(cache, candidate)) {
        nextResult.push(candidate);
      }
    }

    return {
      ...cache,
      result: nextResult,
      pendingMutations: [],
      version: this.state.getMutationVersion(),
    };
  }

  private patchSearchCacheForUpdatedItem(
    cache: MergeSearchCache<T>,
    previousItem: T,
    nextItem: T,
  ): MergeSearchCache<T> | null {
    if (!this.canPatchStoredDatasetSearch(cache)) {
      return null;
    }

    const nextResult = cache.result.slice();
    const previousPosition = nextResult.indexOf(previousItem);
    const nextMatches = this.doesItemMatchSearchCache(cache, nextItem);

    if (previousPosition !== -1) {
      if (nextMatches) {
        nextResult[previousPosition] = nextItem;
      } else {
        nextResult.splice(previousPosition, 1);
      }
    } else if (nextMatches) {
      const insertPosition = this.findDatasetInsertPosition(
        nextResult,
        nextItem,
      );
      nextResult.splice(insertPosition, 0, nextItem);
    }

    return {
      ...cache,
      result: nextResult,
      pendingMutations: [],
      version: this.state.getMutationVersion(),
    };
  }

  private isPatchableFilterCriterion(criterion: FilterCriterion<T>): boolean {
    return !String(criterion.field).includes(".");
  }

  private doesItemMatchFilterCache(
    cache: MergeFilterCache<T>,
    item: T,
  ): boolean {
    for (let index = 0; index < cache.criteria.length; index++) {
      const criterion = cache.criteria[index];

      if (!this.isPatchableFilterCriterion(criterion)) {
        return false;
      }

      const fieldValue = item[criterion.field as keyof T];

      if (
        criterion.values !== undefined &&
        criterion.values.length > 0 &&
        !criterion.values.includes(fieldValue)
      ) {
        return false;
      }

      if (
        criterion.exclude !== undefined &&
        criterion.exclude.length > 0 &&
        criterion.exclude.includes(fieldValue)
      ) {
        return false;
      }
    }

    return true;
  }

  private patchFilterCacheForAddedItems(
    cache: MergeFilterCache<T>,
    items: T[],
  ): MergeFilterCache<T> | null {
    if (!this.canPatchStoredDatasetFilter(cache)) {
      return null;
    }

    const nextResult = cache.result.slice();

    for (let index = 0; index < items.length; index++) {
      const candidate = items[index];

      if (this.doesItemMatchFilterCache(cache, candidate)) {
        nextResult.push(candidate);
      }
    }

    return {
      ...cache,
      result: nextResult,
      pendingMutations: [],
      version: this.state.getMutationVersion(),
    };
  }

  private patchFilterCacheForUpdatedItem(
    cache: MergeFilterCache<T>,
    previousItem: T,
    nextItem: T,
  ): MergeFilterCache<T> | null {
    if (!this.canPatchStoredDatasetFilter(cache)) {
      return null;
    }

    const nextResult = cache.result.slice();
    const previousPosition = nextResult.indexOf(previousItem);
    const nextMatches = this.doesItemMatchFilterCache(cache, nextItem);

    if (previousPosition !== -1) {
      if (nextMatches) {
        nextResult[previousPosition] = nextItem;
      } else {
        nextResult.splice(previousPosition, 1);
      }
    } else if (nextMatches) {
      const insertPosition = this.findDatasetInsertPosition(
        nextResult,
        nextItem,
      );
      nextResult.splice(insertPosition, 0, nextItem);
    }

    return {
      ...cache,
      result: nextResult,
      pendingMutations: [],
      version: this.state.getMutationVersion(),
    };
  }

  private patchSortCacheForAddedItems(
    cache: MergeSortCache<T>,
    items: T[],
  ): MergeSortCache<T> | null {
    if (!this.canPatchStoredDatasetSort(cache)) {
      return null;
    }

    const nextResult = cache.result.slice();

    for (let index = 0; index < items.length; index++) {
      const candidate = items[index];
      const insertPosition = this.findSortInsertPosition(
        nextResult,
        candidate,
        cache.descriptors,
      );
      nextResult.splice(insertPosition, 0, candidate);
    }

    return {
      ...cache,
      result: nextResult,
      pendingMutations: [],
      version: this.state.getMutationVersion(),
    };
  }

  private patchSortCacheForUpdatedItem(
    cache: MergeSortCache<T>,
    previousItem: T,
    nextItem: T,
  ): MergeSortCache<T> | null {
    if (!this.canPatchStoredDatasetSort(cache)) {
      return null;
    }

    const nextResult = cache.result.slice();
    const previousPosition = nextResult.indexOf(previousItem);

    if (previousPosition === -1) {
      if (cache.result.indexOf(nextItem) !== -1) {
        return {
          ...cache,
          pendingMutations: [],
          version: this.state.getMutationVersion(),
        };
      }

      return null;
    }

    const sortFieldsChanged = cache.descriptors.some(
      ({ field }) => previousItem[field] !== nextItem[field],
    );

    if (!sortFieldsChanged) {
      nextResult[previousPosition] = nextItem;

      return {
        ...cache,
        result: nextResult,
        pendingMutations: [],
        version: this.state.getMutationVersion(),
      };
    }

    nextResult.splice(previousPosition, 1);

    const insertPosition = this.findSortInsertPosition(
      nextResult,
      nextItem,
      cache.descriptors,
    );
    nextResult.splice(insertPosition, 0, nextItem);

    return {
      ...cache,
      result: nextResult,
      pendingMutations: [],
      version: this.state.getMutationVersion(),
    };
  }

  private patchSortCacheForRemovedItems(
    cache: MergeSortCache<T>,
    removedItems: T[],
  ): MergeSortCache<T> | null {
    if (!this.canPatchStoredDatasetSort(cache)) {
      return null;
    }

    const removedItemsSet = new Set(removedItems);

    return {
      ...cache,
      result: Array.prototype.filter.call(
        cache.result,
        (item: T) => !removedItemsSet.has(item),
      ) as T[],
      pendingMutations: [],
      version: this.state.getMutationVersion(),
    };
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
      const resolvedSearchState =
        this.resolvePendingSearchCache(previousSearchState);

      if (resolvedSearchState !== null) {
        this.previousSearchState = resolvedSearchState;

        return this.withChain(
          this.trackPreviousResult(resolvedSearchState.result, originData),
        );
      }

      this.previousSearchState = null;
    }

    const result =
      maybeQuery === undefined
        ? this.searchModule.executeSearch(fieldOrQuery)
        : this.searchModule.executeSearch(
            fieldOrQuery as (keyof T & string) | (string & {}),
            maybeQuery,
          );

    this.previousSearchState = {
      key: cacheKey,
      originData,
      result,
      version: mutationVersion,
      field: maybeQuery === undefined ? null : fieldOrQuery,
      lowerQuery: (maybeQuery ?? fieldOrQuery).trim().toLowerCase(),
      pendingMutations: [],
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
        const resolvedSortState =
          this.resolvePendingSortCache(previousSortState);

        if (resolvedSortState !== null) {
          this.previousSortState = resolvedSortState;

          return this.withChain(
            this.trackPreviousResult(resolvedSortState.result, sourceData),
          );
        }

        this.previousSortState = null;
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
        descriptors: resolvedDescriptors,
        pendingMutations: [],
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
      const previousResultInput = this.getPreviousResultInput();
      const sourceData = previousResultInput ?? this.state.getOriginData();
      const resolvedCriteria = dataOrCriteria as FilterCriterion<T>[];
      const mutationVersion = this.state.getMutationVersion();
      const cacheKey = this.createFilterCacheKey(resolvedCriteria);
      const previousFilterState = this.previousFilterState;

      if (
        previousFilterState?.sourceData === sourceData &&
        previousFilterState.key === cacheKey &&
        previousFilterState.version === mutationVersion
      ) {
        const resolvedFilterState =
          this.resolvePendingFilterCache(previousFilterState);

        if (resolvedFilterState !== null) {
          this.previousFilterState = resolvedFilterState;

          return this.withChain(
            this.trackPreviousResult(resolvedFilterState.result, sourceData),
          );
        }

        this.previousFilterState = null;
      }

      const result =
        previousResultInput === null
          ? this.filterModule.executeFilter(resolvedCriteria)
          : this.filterModule.executeFilter(
              previousResultInput,
              resolvedCriteria,
            );

      this.previousFilterState = {
        key: cacheKey,
        sourceData,
        result,
        version: mutationVersion,
        criteria: resolvedCriteria,
        pendingMutations: [],
      };

      return this.withChain(this.trackPreviousResult(result, sourceData));
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

    this.state.add(items);

    return this;
  }

  delete(
    field: IndexableKey<T> & string,
    value: T[IndexableKey<T> & string],
  ): this;
  delete(
    field: IndexableKey<T> & string,
    values: T[IndexableKey<T> & string][],
  ): this;
  delete(
    field: IndexableKey<T> & string,
    valueOrValues: T[IndexableKey<T> & string] | T[IndexableKey<T> & string][],
  ): this {
    const values = normalizeDeleteValues(valueOrValues);

    if (values.length === 0) {
      return this;
    }

    const duplicateValues = findDuplicateDeleteValues(
      this.state.getOriginData(),
      field,
      values,
    );

    if (duplicateValues.length > 0) {
      throw new Error(
        createNonUniqueDeleteErrorMessage(
          "MergeEngines",
          field,
          duplicateValues,
        ),
      );
    }

    if (values.length === 1) {
      this.state.removeByFieldValue(field, values[0]);
      return this;
    }

    this.state.removeByFieldValues(field, values);
    return this;
  }

  update(descriptor: UpdateDescriptor<T>): this {
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
    this.state.data(data);

    return this;
  }

  clearData(module: MergeModuleName): this {
    if (this.getAdapter(module)) {
      this.state.clearData();
      return this;
    }

    throw MergeEnginesError.unavailableEngine(module);
  }
}
