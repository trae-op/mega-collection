/**
 * TextSearchEngine class for performing fast substring search on string fields
 * using n-gram indexing and intersection.
 */

import { State } from "../State";
import {
  CollectionItem,
  type StateMutation,
  type UpdateDescriptor,
} from "../types";
import type {
  SearchIndex,
  SearchQueryOptions,
  SearchRuntime,
  TextSearchEngineStats,
  TextSearchEngineOptions,
} from "./types";
import {
  buildIntersectionQueryGrams,
  createIntersectionPlan,
  MINIMUM_INDEXED_QUERY_LENGTH,
  indexLowerValue,
  intersectPostingListsInCandidates,
  intersectPostingLists,
  removeLowerValue,
} from "./ngram";
import { SearchNestedCollection } from "./nested";

type SearchResult<T extends CollectionItem> = {
  items: T[];
  indices: number[];
};

type SearchWindow = {
  offset: number;
  limit: number;
  take: number;
  hasWindow: boolean;
};

type SearchSource = {
  indices: number[] | null;
  lookup: Uint8Array | null;
};

const createSearchRuntime = <T extends CollectionItem>(): SearchRuntime<T> => ({
  indexedFields: new Set<keyof T & string>(),
  flatIndexes: new Map<string, SearchIndex>(),
  nestedStorage: {
    ngramIndexes: new Map<string, Map<string, Set<number>>>(),
    normalizedFieldValues: new Map<string, string[]>(),
  },
  deferredMutationVersion: null,
  filterByPreviousResult: false,
  previousResultIndices: null,
  previousResultLookup: null,
  previousQuery: null,
  stats: {
    totalQueries: 0,
    indexedQueries: 0,
    fallbackQueries: 0,
    fallbackFields: new Map<string, number>(),
  },
});

const MERGE_SHARED_SCOPE = "__merge__";
const DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY =
  "deferSearchMutationIndexUpdates";

export class TextSearchEngine<T extends CollectionItem> {
  private readonly state: State<T>;

  private readonly namespace: string;

  private readonly nestedCollection: SearchNestedCollection<T>;

  private readonly minQueryLength: number;

  private readonly silent: boolean;

  private cachedIndexedFieldsList: string[] | null = null;

  private cachedLinearSearchFieldsList: string[] | null = null;

  private readonly emittedWarningKeys = new Set<string>();

  private readonly warnings: string[] = [];

  /**
   * Lightweight normalizedValues-only cache for fields without n-gram index.
   * Built lazily on first full-dataset linear scan for non-indexed fields.
   */
  private normalizedValuesCache = new Map<string, string[]>();

  private combinedNormalizedValuesCache: {
    fieldsKey: string;
    values: string[];
  } | null = null;

  /**
   * Creates a new TextSearchEngine with optional data and fields to index.
   */
  constructor(options: TextSearchEngineOptions<T> & { state?: State<T> } = {}) {
    this.minQueryLength = options.minQueryLength ?? 1;
    this.silent = options.silent ?? false;
    this.state = options.state ?? new State(options.data ?? []);
    this.namespace = this.state.createNamespace("search");
    this.nestedCollection = new SearchNestedCollection<T>(
      this.runtime.nestedStorage,
    );
    this.nestedCollection.registerFields(options.nestedFields);
    this.state.subscribe((mutation) => this.handleStateMutation(mutation));

    if (options.filterByPreviousResult) {
      this.runtime.filterByPreviousResult = true;
    }

    const hasFields = options.fields?.length;
    const hasNestedFields = this.nestedCollection.hasRegisteredFields();

    if (hasFields) {
      for (const field of options.fields!) {
        this.indexedFields.add(field);
      }
    }

    if (this.dataset.length > 0 && (hasFields || hasNestedFields)) {
      this.rebuildConfiguredIndexes();
    }
  }

  private get dataset(): T[] {
    return this.state.getOriginData();
  }

  private get runtime(): SearchRuntime<T> {
    return this.state.getOrCreateScopedValue<SearchRuntime<T>>(
      this.namespace,
      "runtime",
      createSearchRuntime,
    );
  }

  private get flatIndexes(): Map<string, SearchIndex> {
    return this.runtime.flatIndexes;
  }

  private get indexedFields(): Set<keyof T & string> {
    return this.runtime.indexedFields;
  }

  private shouldDeferMutationIndexUpdates(): boolean {
    return (
      this.state.getScopedValue<boolean>(
        MERGE_SHARED_SCOPE,
        DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY,
      ) === true
    );
  }

  private markDeferredMutationState(): void {
    this.runtime.deferredMutationVersion = this.state.getMutationVersion();
    this.flatIndexes.clear();
    this.nestedCollection.clearIndexes();
    this.cachedIndexedFieldsList = null;
    this.cachedLinearSearchFieldsList = null;
    this.normalizedValuesCache.clear();
    this.combinedNormalizedValuesCache = null;
    this.clearPreviousSearchState();
  }

  private ensureConfiguredIndexesReady(): void {
    if (this.runtime.deferredMutationVersion === null) {
      return;
    }

    this.runtime.deferredMutationVersion = null;

    if (
      this.dataset.length > 0 &&
      (this.indexedFields.size > 0 ||
        this.nestedCollection.hasRegisteredFields())
    ) {
      this.rebuildConfiguredIndexes();
    }
  }

  private rebuildConfiguredIndexes(): void {
    this.flatIndexes.clear();
    this.nestedCollection.clearIndexes();
    this.cachedIndexedFieldsList = null;
    this.cachedLinearSearchFieldsList = null;
    this.normalizedValuesCache.clear();
    this.combinedNormalizedValuesCache = null;

    for (const field of this.indexedFields) {
      this.buildIndexFromData(this.dataset, field);
    }

    if (this.nestedCollection.hasRegisteredFields()) {
      this.nestedCollection.buildIndexes(this.dataset);
    }
  }

  /**
   * Builds an n-gram index for the given field from arbitrary data.
   */
  private buildIndexFromData(data: T[], field: keyof T & string): void {
    const version = this.state.getMutationVersion();
    const ngramMap = new Map<string, Set<number>>();
    const normalizedValues = new Array<string>(data.length);

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const rawValue = data[itemIndex][field];
      if (typeof rawValue !== "string") continue;

      const lower = rawValue.toLowerCase();
      normalizedValues[itemIndex] = lower;
      indexLowerValue(ngramMap, lower, itemIndex);
    }

    this.flatIndexes.set(field as string, {
      ngramMap,
      normalizedValues,
      version,
    });
  }

  search(query: string, options?: SearchQueryOptions): T[];
  search(
    field: (keyof T & string) | (string & {}),
    query: string,
    options?: SearchQueryOptions,
  ): T[];
  search(
    fieldOrQuery: string,
    queryOrOptions?: string | SearchQueryOptions,
    maybeOptions?: SearchQueryOptions,
  ): T[] {
    if (typeof queryOrOptions === "string") {
      return this.searchField(fieldOrQuery, queryOrOptions, maybeOptions);
    }

    return this.searchAll(fieldOrQuery, queryOrOptions);
  }

  searchAll(query: string, options?: SearchQueryOptions): T[] {
    return this.searchAllFields(query, options);
  }

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  private normalizeSearchWindow(options?: SearchQueryOptions): SearchWindow {
    const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
    const rawLimit = options?.limit;
    const limit =
      rawLimit === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Math.trunc(rawLimit));
    const take = Number.isFinite(limit)
      ? offset + limit
      : Number.POSITIVE_INFINITY;

    return {
      offset,
      limit,
      take,
      hasWindow: offset > 0 || Number.isFinite(limit),
    };
  }

  private shouldTrackPreviousResult(window: SearchWindow): boolean {
    return !window.hasWindow;
  }

  private hasReachedWindowLimit(window: SearchWindow, count: number): boolean {
    return Number.isFinite(window.limit) && count >= window.limit;
  }

  private sliceItems(items: T[], window: SearchWindow): T[] {
    if (!window.hasWindow) {
      return items;
    }

    return items.slice(window.offset, window.take);
  }

  private collectItemsFromIndices(
    indices: number[],
    window: SearchWindow,
  ): SearchResult<T> {
    const slicedIndices =
      window.hasWindow && indices.length > 0
        ? indices.slice(window.offset, window.take)
        : indices;
    const items: T[] = [];

    for (let index = 0; index < slicedIndices.length; index++) {
      const item = this.dataset[slicedIndices[index]];
      if (item) {
        items.push(item);
      }
    }

    return { items, indices: slicedIndices };
  }

  private createLookup(indices: number[]): Uint8Array {
    const lookup = new Uint8Array(this.dataset.length);

    for (let index = 0; index < indices.length; index++) {
      lookup[indices[index]] = 1;
    }

    return lookup;
  }

  private getRestrictionLookup(indices: number[]): Uint8Array {
    const cachedLookup = this.runtime.previousResultLookup;

    if (
      cachedLookup !== null &&
      this.runtime.previousResultIndices === indices &&
      cachedLookup.length === this.dataset.length
    ) {
      return cachedLookup;
    }

    const lookup = this.createLookup(indices);
    this.runtime.previousResultLookup = lookup;
    return lookup;
  }

  /**
   * Returns the data source for search based on filterByPreviousResult setting.
   * When the new query narrows the previous one, returns previousResult with indices.
   * Otherwise resets previous state and returns the full dataset.
   */
  private getSearchSource(lowerQuery: string): SearchSource {
    const { runtime } = this;
    if (!runtime.filterByPreviousResult) {
      return { indices: null, lookup: null };
    }

    if (
      runtime.previousQuery !== null &&
      runtime.previousResultIndices !== null &&
      lowerQuery.includes(runtime.previousQuery)
    ) {
      return {
        indices: runtime.previousResultIndices,
        lookup: this.getRestrictionLookup(runtime.previousResultIndices),
      };
    }

    runtime.previousResultIndices = null;
    runtime.previousResultLookup = null;
    runtime.previousQuery = null;
    return { indices: null, lookup: null };
  }

  /**
   * Saves the search result for potential reuse on subsequent narrowing queries.
   */
  private saveSearchResult(indices: number[], query: string): void {
    const { runtime } = this;
    if (!runtime.filterByPreviousResult) return;

    runtime.previousResultIndices = indices;
    runtime.previousResultLookup = null;
    runtime.previousQuery = query;
  }

  private persistSearchResult(
    result: SearchResult<T>,
    lowerQuery: string,
    shouldTrack: boolean,
  ): void {
    if (!shouldTrack) {
      return;
    }

    this.saveSearchResult(result.indices, lowerQuery);
  }

  /**
   * Resets the previous search result, forcing the next search to use the full dataset.
   *
   * @see {@link TextSearchEngineOptions.filterByPreviousResult}
   */
  resetSearchState(): this {
    this.clearPreviousSearchState();
    return this;
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  getStats(): TextSearchEngineStats {
    const { totalQueries, indexedQueries, fallbackQueries, fallbackFields } =
      this.runtime.stats;

    return {
      totalQueries,
      indexedQueries,
      fallbackQueries,
      fallbackRate: totalQueries === 0 ? 0 : fallbackQueries / totalQueries,
      fallbackFields: Object.fromEntries(fallbackFields),
    };
  }

  resetStats(): this {
    const { stats } = this.runtime;
    stats.totalQueries = 0;
    stats.indexedQueries = 0;
    stats.fallbackQueries = 0;
    stats.fallbackFields.clear();
    return this;
  }

  private clearPreviousSearchState(): void {
    const { runtime } = this;
    runtime.previousResultIndices = null;
    runtime.previousResultLookup = null;
    runtime.previousQuery = null;
  }

  private recordIndexedQuery(): void {
    const { stats } = this.runtime;
    stats.totalQueries += 1;
    stats.indexedQueries += 1;
  }

  private recordFallbackQuery(scope: string): void {
    const { stats } = this.runtime;
    stats.totalQueries += 1;
    stats.fallbackQueries += 1;
    stats.fallbackFields.set(scope, (stats.fallbackFields.get(scope) ?? 0) + 1);
  }

  private shouldEmitFallbackWarning(lowerQuery: string): boolean {
    return !this.silent && lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH;
  }

  private warnAboutFallback(
    scope: string,
    lowerQuery: string,
    reason: string,
  ): void {
    if (!this.shouldEmitFallbackWarning(lowerQuery)) {
      return;
    }

    const warningKey = `${scope}\u0000${lowerQuery}\u0000${reason}`;
    if (this.emittedWarningKeys.has(warningKey)) {
      return;
    }

    this.emittedWarningKeys.add(warningKey);

    const message =
      `[TextSearchEngine] warn: query "${lowerQuery}" on ${scope} used linear fallback. ` +
      `${reason}. Add the field(s) to the index schema to enable indexed search.`;

    this.warnings.push(message);

    if (
      typeof process !== "undefined" &&
      process.env.NODE_ENV !== "production" &&
      process.env.NODE_ENV !== "test"
    ) {
      console.warn(message);
    }
  }

  private getResolvedFlatIndex(field: string): SearchIndex | undefined {
    const currentVersion = this.state.getMutationVersion();
    let index = this.flatIndexes.get(field);

    if (index && index.version !== currentVersion && this.dataset.length > 0) {
      this.buildIndexFromData(this.dataset, field as keyof T & string);
      index = this.flatIndexes.get(field);
    }

    return index;
  }

  private getQueryGrams(lowerQuery: string): ReadonlySet<string> | null {
    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    return uniqueQueryGrams.size > 0 ? uniqueQueryGrams : null;
  }

  /**
   * Searches all indexed fields.
   */
  private searchAllFields(query: string, options?: SearchQueryOptions): T[] {
    const lowerQuery = this.normalizeQuery(query);
    const window = this.normalizeSearchWindow(options);
    const scope = "all fields";

    if (window.limit === 0) {
      return [];
    }

    if (!lowerQuery || lowerQuery.length < this.minQueryLength) {
      return this.sliceItems(this.dataset, window);
    }

    if (lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH) {
      this.ensureConfiguredIndexesReady();
    }

    const shouldTrack = this.shouldTrackPreviousResult(window);
    const { indices: sourceIndices, lookup: sourceLookup } =
      this.getSearchSource(lowerQuery);
    let uniqueQueryGrams: ReadonlySet<string> | null | undefined;
    const resolveQueryGrams = (): ReadonlySet<string> | null => {
      if (uniqueQueryGrams !== undefined) {
        return uniqueQueryGrams;
      }

      uniqueQueryGrams =
        lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH
          ? this.getQueryGrams(lowerQuery)
          : null;

      return uniqueQueryGrams;
    };

    if (sourceIndices !== null) {
      const preparedQueryGrams = resolveQueryGrams();

      if (preparedQueryGrams !== null) {
        if (this.flatIndexes.size > 0 || this.nestedCollection.hasIndexes()) {
          this.recordIndexedQuery();
          const result = this.searchAllFieldsIndexed(
            lowerQuery,
            preparedQueryGrams,
            window,
            sourceLookup,
            sourceIndices,
          );
          this.persistSearchResult(result, lowerQuery, shouldTrack);
          return result.items;
        }
      }

      this.recordFallbackQuery(scope);
      const result = this.searchLinearAllFields(
        this.dataset,
        lowerQuery,
        sourceIndices,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    if (!this.flatIndexes.size && !this.nestedCollection.hasIndexes()) {
      this.warnAboutFallback(
        scope,
        lowerQuery,
        this.indexedFields.size > 0
          ? "configured indexes are not currently built"
          : "no indexed fields are configured",
      );
      this.recordFallbackQuery(scope);

      const result = this.searchLinearAllFields(
        this.dataset,
        lowerQuery,
        null,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    const preparedQueryGrams = resolveQueryGrams();
    if (preparedQueryGrams === null) {
      this.recordFallbackQuery(scope);
      const result = this.searchLinearAllFields(
        this.dataset,
        lowerQuery,
        null,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    this.recordIndexedQuery();
    const result = this.searchAllFieldsIndexed(
      lowerQuery,
      preparedQueryGrams,
      window,
      null,
    );
    this.persistSearchResult(result, lowerQuery, shouldTrack);
    return result.items;
  }

  private searchAllFieldsIndexed(
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    window: SearchWindow,
    restrictionLookup: Uint8Array | null,
    candidateIndices: readonly number[] | null = null,
  ): SearchResult<T> {
    if (
      candidateIndices !== null &&
      !this.nestedCollection.hasRegisteredFields() &&
      this.flatIndexes.size > 0
    ) {
      return this.searchAllFieldsIndexedInCandidates(
        lowerQuery,
        uniqueQueryGrams,
        window,
        restrictionLookup,
        candidateIndices,
      );
    }

    const dataset = this.dataset;
    const seen = new Uint8Array(dataset.length);
    const combinedIndices: number[] = [];
    let matchedCount = 0;

    for (const field of this.flatIndexes.keys()) {
      const indices = this.searchFieldWithPreparedQueryIndices(
        field,
        lowerQuery,
        uniqueQueryGrams,
        restrictionLookup,
        candidateIndices,
      );

      for (let index = 0; index < indices.length; index++) {
        const datasetIndex = indices[index];
        if (seen[datasetIndex]) continue;

        seen[datasetIndex] = 1;
        if (matchedCount < window.offset) {
          matchedCount += 1;
          continue;
        }

        combinedIndices.push(datasetIndex);
        matchedCount += 1;

        if (this.hasReachedWindowLimit(window, combinedIndices.length)) {
          return this.materializeIndicesResult(combinedIndices);
        }
      }
    }

    for (const datasetIndex of this.nestedCollection.searchAllIndexedFieldIndices(
      lowerQuery,
      uniqueQueryGrams,
      restrictionLookup,
      candidateIndices,
    )) {
      if (seen[datasetIndex]) continue;

      seen[datasetIndex] = 1;
      if (matchedCount < window.offset) {
        matchedCount += 1;
        continue;
      }

      combinedIndices.push(datasetIndex);
      matchedCount += 1;

      if (this.hasReachedWindowLimit(window, combinedIndices.length)) {
        return this.materializeIndicesResult(combinedIndices);
      }
    }

    return this.materializeIndicesResult(combinedIndices);
  }

  private searchAllFieldsIndexedInCandidates(
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    window: SearchWindow,
    restrictionLookup: Uint8Array | null,
    candidateIndices: readonly number[],
  ): SearchResult<T> {
    const fieldPlans: ((candidateIndex: number) => boolean)[] = [];

    for (const field of this.flatIndexes.keys()) {
      const index = this.getResolvedFlatIndex(field);
      if (!index) {
        continue;
      }

      const plan = createIntersectionPlan(
        index.ngramMap,
        uniqueQueryGrams,
        index.normalizedValues,
        lowerQuery,
      );
      if (plan !== null) {
        fieldPlans.push(plan.matches);
      }
    }

    if (fieldPlans.length === 0) {
      return { items: [], indices: [] };
    }

    const matchedIndices: number[] = [];
    let matchedCount = 0;

    for (
      let candidateOffset = 0;
      candidateOffset < candidateIndices.length;
      candidateOffset++
    ) {
      const candidateIndex = candidateIndices[candidateOffset];
      if (restrictionLookup !== null && !restrictionLookup[candidateIndex]) {
        continue;
      }

      let hasMatch = false;
      for (let fieldIndex = 0; fieldIndex < fieldPlans.length; fieldIndex++) {
        if (fieldPlans[fieldIndex](candidateIndex)) {
          hasMatch = true;
          break;
        }
      }

      if (!hasMatch) {
        continue;
      }

      if (matchedCount < window.offset) {
        matchedCount += 1;
        continue;
      }

      matchedIndices.push(candidateIndex);
      matchedCount += 1;

      if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
        break;
      }
    }

    return this.materializeIndicesResult(matchedIndices);
  }

  /**
   * Searches a specific field.
   */
  private searchField(
    field: string,
    query: string,
    options?: SearchQueryOptions,
  ): T[] {
    const lowerQuery = this.normalizeQuery(query);
    const window = this.normalizeSearchWindow(options);
    const scope = `field "${field}"`;

    if (window.limit === 0) {
      return [];
    }

    if (!lowerQuery || lowerQuery.length < this.minQueryLength) {
      return this.sliceItems(this.dataset, window);
    }

    if (lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH) {
      this.ensureConfiguredIndexesReady();
    }

    const shouldTrack = this.shouldTrackPreviousResult(window);
    const { indices: sourceIndices, lookup: sourceLookup } =
      this.getSearchSource(lowerQuery);
    const isNested = this.nestedCollection.hasField(field);
    let uniqueQueryGrams: ReadonlySet<string> | null | undefined;
    const resolveQueryGrams = (): ReadonlySet<string> | null => {
      if (uniqueQueryGrams !== undefined) {
        return uniqueQueryGrams;
      }

      uniqueQueryGrams =
        lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH
          ? this.getQueryGrams(lowerQuery)
          : null;

      return uniqueQueryGrams;
    };

    if (sourceIndices !== null) {
      const preparedQueryGrams = resolveQueryGrams();

      if (isNested) {
        if (preparedQueryGrams !== null && this.nestedCollection.hasIndexes()) {
          this.recordIndexedQuery();
          const indices = this.nestedCollection.searchIndexedFieldIndices(
            field,
            lowerQuery,
            preparedQueryGrams,
            sourceLookup,
            sourceIndices,
            window.take,
          );
          const result = this.collectItemsFromIndices(indices, window);
          this.persistSearchResult(result, lowerQuery, shouldTrack);
          return result.items;
        }

        this.recordFallbackQuery(scope);
        const result = this.searchLinearSingleField(
          this.dataset,
          field,
          lowerQuery,
          sourceIndices,
          window,
        );
        this.persistSearchResult(result, lowerQuery, shouldTrack);
        return result.items;
      }

      if (preparedQueryGrams !== null && this.flatIndexes.has(field)) {
        this.recordIndexedQuery();
        const result = this.searchFieldWithPreparedQuery(
          field,
          lowerQuery,
          preparedQueryGrams,
          window,
          sourceLookup,
          sourceIndices,
        );
        this.persistSearchResult(result, lowerQuery, shouldTrack);
        return result.items;
      }

      this.recordFallbackQuery(scope);
      const result = this.searchLinearSingleField(
        this.dataset,
        field,
        lowerQuery,
        sourceIndices,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    if (isNested) {
      if (
        lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH &&
        this.nestedCollection.hasIndexes()
      ) {
        const uniqueQueryGrams = this.getQueryGrams(lowerQuery);
        if (uniqueQueryGrams === null) {
          return [];
        }

        this.recordIndexedQuery();
        const indices = this.nestedCollection.searchIndexedFieldIndices(
          field,
          lowerQuery,
          uniqueQueryGrams,
          null,
          null,
          window.take,
        );
        const result = this.collectItemsFromIndices(indices, window);
        this.persistSearchResult(result, lowerQuery, shouldTrack);
        return result.items;
      }

      this.recordFallbackQuery(scope);
      const result = this.searchLinearSingleField(
        this.dataset,
        field,
        lowerQuery,
        null,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    if (!this.flatIndexes.size) {
      this.warnAboutFallback(
        scope,
        lowerQuery,
        this.indexedFields.size > 0
          ? `field "${field}" is not backed by an active index`
          : "no indexed fields are configured",
      );
    }

    const preparedQueryGrams = resolveQueryGrams();

    if (this.flatIndexes.size > 0 && preparedQueryGrams !== null) {
      if (!this.flatIndexes.has(field)) {
        return [];
      }

      this.recordIndexedQuery();
      const result = this.searchFieldWithPreparedQuery(
        field,
        lowerQuery,
        preparedQueryGrams,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    this.recordFallbackQuery(scope);
    const result = this.searchLinearSingleField(
      this.dataset,
      field,
      lowerQuery,
      null,
      window,
    );
    this.persistSearchResult(result, lowerQuery, shouldTrack);
    return result.items;
  }

  /**
   * Searches a field using prepared query grams, returning matched items and indices.
   * Delegates to searchFieldWithPreparedQueryIndices for the core intersection logic.
   */
  private searchFieldWithPreparedQuery(
    field: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    window: SearchWindow,
    restrictionLookup: Uint8Array | null = null,
    candidateIndices: readonly number[] | null = null,
  ): SearchResult<T> {
    const indices = this.searchFieldWithPreparedQueryIndices(
      field,
      lowerQuery,
      uniqueQueryGrams,
      restrictionLookup,
      candidateIndices,
      window.take,
    );

    return this.collectItemsFromIndices(indices, window);
  }

  /**
   * Core indexed search: returns dataset indices of matching items.
   * If the cached index is stale (version mismatch), rebuilds it lazily.
   */
  private searchFieldWithPreparedQueryIndices(
    field: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    restrictionLookup: Uint8Array | null = null,
    candidateIndices: readonly number[] | null = null,
    take = Number.POSITIVE_INFINITY,
  ): number[] {
    const index = this.getResolvedFlatIndex(field);
    if (!index) return [];

    const { ngramMap, normalizedValues } = index;

    if (candidateIndices !== null) {
      return intersectPostingListsInCandidates(
        ngramMap,
        uniqueQueryGrams,
        normalizedValues,
        lowerQuery,
        { candidateIndices, restrictionLookup, take },
      );
    }

    return intersectPostingLists(
      ngramMap,
      uniqueQueryGrams,
      normalizedValues,
      lowerQuery,
      { restrictionLookup, take },
    );
  }

  /**
   * Returns the cached list of indexed field names, rebuilding if stale.
   */
  private getIndexedFieldsList(): string[] {
    if (this.cachedIndexedFieldsList === null) {
      this.cachedIndexedFieldsList = Array.from(this.indexedFields);
    }
    return this.cachedIndexedFieldsList;
  }

  private materializeIndicesResult(indices: number[]): SearchResult<T> {
    const items: T[] = [];

    for (let index = 0; index < indices.length; index++) {
      const item = this.dataset[indices[index]];
      if (item) {
        items.push(item);
      }
    }

    return { items, indices };
  }

  private getLinearSearchFields(data: T[]): string[] {
    const indexedFieldsList = this.getIndexedFieldsList();
    if (indexedFieldsList.length > 0) {
      return indexedFieldsList;
    }

    if (this.cachedLinearSearchFieldsList !== null) {
      return this.cachedLinearSearchFieldsList;
    }

    this.cachedLinearSearchFieldsList = data.length
      ? Object.keys(data[0]).filter((key) => typeof data[0][key] === "string")
      : [];
    return this.cachedLinearSearchFieldsList;
  }

  /**
   * Eagerly builds normalizedValues for a field without n-gram overhead.
   * Stores in a lightweight cache so subsequent linear scans reuse it.
   */
  private buildNormalizedValuesOnly(data: T[], field: string): string[] {
    const normalizedValues = new Array<string>(data.length);
    for (let i = 0, len = data.length; i < len; i++) {
      const rawValue = data[i][field];
      if (typeof rawValue === "string") {
        normalizedValues[i] = rawValue.toLowerCase();
      }
    }

    this.normalizedValuesCache.set(field, normalizedValues);
    return normalizedValues;
  }

  private buildCombinedNormalizedValues(data: T[], fields: string[]): string[] {
    const combinedValues = new Array<string>(data.length);

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      combinedValues[itemIndex] = this.buildCombinedNormalizedValue(
        data[itemIndex],
        fields,
      );
    }

    this.combinedNormalizedValuesCache = {
      fieldsKey: fields.join("\u0000"),
      values: combinedValues,
    };

    return combinedValues;
  }

  private buildCombinedNormalizedValue(item: T, fields: string[]): string {
    let combinedValue = "";

    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
      const value = item[fields[fieldIndex]];
      if (typeof value !== "string") {
        continue;
      }

      if (combinedValue) {
        combinedValue += "\n";
      }

      combinedValue += value.toLowerCase();
    }

    return combinedValue;
  }

  private getCombinedNormalizedValues(
    data: T[],
    fields: string[],
  ): string[] | null {
    if (data !== this.dataset) {
      return null;
    }

    const fieldsKey = fields.join("\u0000");
    if (this.combinedNormalizedValuesCache?.fieldsKey === fieldsKey) {
      return this.combinedNormalizedValuesCache.values;
    }

    return this.buildCombinedNormalizedValues(data, fields);
  }

  /**
   * Updates only the entry at `index` in every cached normalizedValues array,
   * avoiding a full O(n) rebuild when a single item is updated.
   */
  private invalidateNormalizedValuesCacheEntry(index: number, item: T): void {
    for (const [field, values] of this.normalizedValuesCache) {
      const rawValue = item[field];
      values[index] =
        typeof rawValue === "string" ? rawValue.toLowerCase() : "";
    }

    if (this.combinedNormalizedValuesCache !== null) {
      const fields =
        this.combinedNormalizedValuesCache.fieldsKey.split("\u0000");
      this.combinedNormalizedValuesCache.values[index] =
        this.buildCombinedNormalizedValue(item, fields);
    }
  }

  /**
   * Searches all fields linearly, using pre-normalized values when available.
   * When `sourceIndices` is provided, iterates only those dataset positions
   * (previousResult narrowing path) and resolves items via this.dataset[idx].
   */
  private searchLinearAllFields(
    data: T[],
    lowerQuery: string,
    sourceIndices: number[] | null,
    window: SearchWindow,
  ): SearchResult<T> {
    if (!data.length) return { items: [], indices: [] };

    const fields = this.getLinearSearchFields(data);
    const isFullDataset = data === this.dataset;
    const fieldCount = fields.length;
    const fieldNormValues: (string[] | null)[] = new Array(fieldCount);
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
      const fieldName = fields[fieldIndex];
      const flatIndex = this.flatIndexes.get(fieldName);

      if (flatIndex) {
        fieldNormValues[fieldIndex] = flatIndex.normalizedValues;
      } else {
        const cached = this.normalizedValuesCache.get(fieldName);
        if (cached) {
          fieldNormValues[fieldIndex] = cached;
        } else if (isFullDataset) {
          fieldNormValues[fieldIndex] = this.buildNormalizedValuesOnly(
            data,
            fieldName,
          );
        } else {
          fieldNormValues[fieldIndex] = null;
        }
      }
    }

    const hasNestedFields = this.nestedCollection.hasRegisteredFields();
    const combinedNormalizedValues = hasNestedFields
      ? null
      : this.getCombinedNormalizedValues(data, fields);
    const allNormalizedValuesAvailable =
      !hasNestedFields &&
      fieldNormValues.every(
        (normalizedValues): normalizedValues is string[] =>
          normalizedValues !== null,
      );
    const matchedIndices: number[] = [];
    let matchedCount = 0;

    if (sourceIndices !== null) {
      const dataset = this.dataset;

      if (combinedNormalizedValues !== null) {
        for (
          let sourceIndex = 0;
          sourceIndex < sourceIndices.length;
          sourceIndex++
        ) {
          const datasetIndex = sourceIndices[sourceIndex];
          if (!combinedNormalizedValues[datasetIndex]?.includes(lowerQuery)) {
            continue;
          }

          if (matchedCount < window.offset) {
            matchedCount += 1;
            continue;
          }

          matchedIndices.push(datasetIndex);
          matchedCount += 1;

          if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
            break;
          }
        }

        return this.materializeIndicesResult(matchedIndices);
      }

      if (allNormalizedValuesAvailable) {
        for (
          let sourceIndex = 0;
          sourceIndex < sourceIndices.length;
          sourceIndex++
        ) {
          const datasetIndex = sourceIndices[sourceIndex];
          let hasMatch = false;

          for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
            const normalizedValue = fieldNormValues[fieldIndex][datasetIndex];
            if (normalizedValue && normalizedValue.includes(lowerQuery)) {
              hasMatch = true;
              break;
            }
          }

          if (!hasMatch) {
            continue;
          }

          if (matchedCount < window.offset) {
            matchedCount += 1;
            continue;
          }

          matchedIndices.push(datasetIndex);
          matchedCount += 1;

          if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
            break;
          }
        }

        return this.materializeIndicesResult(matchedIndices);
      }

      for (
        let sourceIndex = 0;
        sourceIndex < sourceIndices.length;
        sourceIndex++
      ) {
        const datasetIndex = sourceIndices[sourceIndex];
        const item = dataset[datasetIndex];
        let hasMatch = false;

        for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
          const normValues = fieldNormValues[fieldIndex];

          if (normValues) {
            const normalizedValue = normValues[datasetIndex];
            if (normalizedValue && normalizedValue.includes(lowerQuery)) {
              hasMatch = true;
              break;
            }
          } else {
            const value = item[fields[fieldIndex]];
            if (
              typeof value === "string" &&
              value.toLowerCase().includes(lowerQuery)
            ) {
              hasMatch = true;
              break;
            }
          }
        }

        if (!hasMatch && hasNestedFields) {
          hasMatch = this.nestedCollection.matchesAnyField(item, lowerQuery);
        }

        if (!hasMatch) {
          continue;
        }

        if (matchedCount < window.offset) {
          matchedCount += 1;
          continue;
        }

        matchedIndices.push(datasetIndex);
        matchedCount += 1;

        if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
          break;
        }
      }

      return this.materializeIndicesResult(matchedIndices);
    }

    if (combinedNormalizedValues !== null) {
      for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
        if (!combinedNormalizedValues[itemIndex]?.includes(lowerQuery)) {
          continue;
        }

        if (matchedCount < window.offset) {
          matchedCount += 1;
          continue;
        }

        matchedIndices.push(itemIndex);
        matchedCount += 1;

        if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
          break;
        }
      }

      return this.materializeIndicesResult(matchedIndices);
    }

    if (allNormalizedValuesAvailable) {
      for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
        let hasMatch = false;

        for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
          const normalizedValue = fieldNormValues[fieldIndex][itemIndex];
          if (normalizedValue && normalizedValue.includes(lowerQuery)) {
            hasMatch = true;
            break;
          }
        }

        if (!hasMatch) {
          continue;
        }

        if (matchedCount < window.offset) {
          matchedCount += 1;
          continue;
        }

        matchedIndices.push(itemIndex);
        matchedCount += 1;

        if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
          break;
        }
      }

      return this.materializeIndicesResult(matchedIndices);
    }

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      let hasMatch = false;

      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        const normValues = fieldNormValues[fieldIndex];

        if (normValues) {
          const normalizedValue = normValues[itemIndex];
          if (normalizedValue && normalizedValue.includes(lowerQuery)) {
            hasMatch = true;
            break;
          }
        } else {
          const value = item[fields[fieldIndex]];
          if (
            typeof value === "string" &&
            value.toLowerCase().includes(lowerQuery)
          ) {
            hasMatch = true;
            break;
          }
        }
      }

      if (!hasMatch && hasNestedFields) {
        hasMatch = this.nestedCollection.matchesAnyField(item, lowerQuery);
      }

      if (!hasMatch) {
        continue;
      }

      if (matchedCount < window.offset) {
        matchedCount += 1;
        continue;
      }

      matchedIndices.push(itemIndex);
      matchedCount += 1;

      if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
        break;
      }
    }

    return this.materializeIndicesResult(matchedIndices);
  }

  /**
   * Searches a specific field linearly, using pre-normalized values when available.
   * When `sourceIndices` is provided, resolves items via this.dataset[idx].
   */
  private searchLinearSingleField(
    data: T[],
    field: string,
    lowerQuery: string,
    sourceIndices: number[] | null,
    window: SearchWindow,
  ): SearchResult<T> {
    if (!data.length) return { items: [], indices: [] };

    if (this.nestedCollection.hasField(field)) {
      const indices = this.nestedCollection.searchFieldLinearIndices(
        data,
        field,
        lowerQuery,
        sourceIndices ?? undefined,
      );
      return this.collectItemsFromIndices(indices, window);
    }

    const matchedIndices: number[] = [];
    const existingIndex = this.flatIndexes.get(field);
    const normValues = existingIndex
      ? existingIndex.normalizedValues
      : (this.normalizedValuesCache.get(field) ??
        (data === this.dataset
          ? this.buildNormalizedValuesOnly(data, field)
          : null));
    let matchedCount = 0;

    if (sourceIndices !== null) {
      const dataset = this.dataset;

      if (normValues) {
        for (
          let sourceIndex = 0;
          sourceIndex < sourceIndices.length;
          sourceIndex++
        ) {
          const datasetIndex = sourceIndices[sourceIndex];
          if (!normValues[datasetIndex]?.includes(lowerQuery)) {
            continue;
          }

          if (matchedCount < window.offset) {
            matchedCount += 1;
            continue;
          }

          matchedIndices.push(datasetIndex);
          matchedCount += 1;

          if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
            break;
          }
        }

        return this.materializeIndicesResult(matchedIndices);
      }

      for (
        let sourceIndex = 0;
        sourceIndex < sourceIndices.length;
        sourceIndex++
      ) {
        const datasetIndex = sourceIndices[sourceIndex];
        const item = dataset[datasetIndex];
        const isMatch =
          typeof item[field] === "string" &&
          item[field].toLowerCase().includes(lowerQuery);

        if (!isMatch) {
          continue;
        }

        if (matchedCount < window.offset) {
          matchedCount += 1;
          continue;
        }

        matchedIndices.push(datasetIndex);
        matchedCount += 1;

        if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
          break;
        }
      }

      return this.materializeIndicesResult(matchedIndices);
    }

    if (normValues) {
      for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
        if (!normValues[itemIndex]?.includes(lowerQuery)) {
          continue;
        }

        if (matchedCount < window.offset) {
          matchedCount += 1;
          continue;
        }

        matchedIndices.push(itemIndex);
        matchedCount += 1;

        if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
          break;
        }
      }

      return this.materializeIndicesResult(matchedIndices);
    }

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const isMatch =
        typeof data[itemIndex][field] === "string" &&
        data[itemIndex][field].toLowerCase().includes(lowerQuery);

      if (!isMatch) {
        continue;
      }

      if (matchedCount < window.offset) {
        matchedCount += 1;
        continue;
      }

      matchedIndices.push(itemIndex);
      matchedCount += 1;

      if (this.hasReachedWindowLimit(window, matchedIndices.length)) {
        break;
      }
    }

    return this.materializeIndicesResult(matchedIndices);
  }

  clearIndexes(): this {
    this.flatIndexes.clear();
    this.nestedCollection.clearIndexes();
    this.normalizedValuesCache.clear();
    this.combinedNormalizedValuesCache = null;
    return this;
  }

  getOriginData(): T[] {
    return this.state.getOriginData();
  }

  data(data: T[]): this {
    this.state.data(data);
    return this;
  }

  add(items: T[]): this {
    this.state.add(items);
    return this;
  }

  update(descriptor: UpdateDescriptor<T>): this {
    this.state.update(descriptor);
    return this;
  }

  private applyAddedItems(items: T[], startIndex: number): this {
    if (items.length === 0) {
      return this;
    }

    for (const field of this.indexedFields) {
      this.addItemsToField(field, items, startIndex);
    }

    this.nestedCollection.addItems(items, startIndex);
    return this;
  }

  clearData(): this {
    this.state.clearData();
    return this;
  }

  private handleStateMutation(mutation: StateMutation<T>): void {
    if (
      this.shouldDeferMutationIndexUpdates() &&
      (mutation.type === "add" || mutation.type === "update")
    ) {
      this.markDeferredMutationState();
      return;
    }

    switch (mutation.type) {
      case "add":
        this.applyAddedItems(mutation.items, mutation.startIndex);
        for (const [field, cachedValues] of this.normalizedValuesCache) {
          for (let offset = 0; offset < mutation.items.length; offset++) {
            const rawValue = mutation.items[offset][field as keyof T];
            cachedValues[mutation.startIndex + offset] =
              typeof rawValue === "string" ? rawValue.toLowerCase() : "";
          }
        }
        this.combinedNormalizedValuesCache = null;
        this.clearPreviousSearchState();
        return;
      case "update":
        this.applyUpdatedItem(
          mutation.index,
          mutation.previousItem,
          mutation.nextItem,
        );
        this.invalidateNormalizedValuesCacheEntry(
          mutation.index,
          mutation.nextItem,
        );
        this.clearPreviousSearchState();
        return;
      case "data":
        this.runtime.deferredMutationVersion = null;
        this.rebuildConfiguredIndexes();
        this.combinedNormalizedValuesCache = null;
        this.clearPreviousSearchState();
        return;
      case "clearData":
        this.runtime.deferredMutationVersion = null;
        this.flatIndexes.clear();
        this.nestedCollection.clearIndexes();
        this.cachedLinearSearchFieldsList = null;
        this.normalizedValuesCache.clear();
        this.combinedNormalizedValuesCache = null;
        this.clearPreviousSearchState();
        return;
      case "remove":
        this.applyRemovedItem(
          mutation.removedItem,
          mutation.removedIndex,
          mutation.movedItem,
          mutation.movedFromIndex,
        );
        this.cachedLinearSearchFieldsList = null;
        this.normalizedValuesCache.clear();
        this.combinedNormalizedValuesCache = null;
        this.clearPreviousSearchState();
        return;
      case "removeMany":
        for (
          let entryIndex = 0;
          entryIndex < mutation.entries.length;
          entryIndex++
        ) {
          const entry = mutation.entries[entryIndex];
          this.applyRemovedItem(
            entry.removedItem,
            entry.removedIndex,
            entry.movedItem,
            entry.movedFromIndex,
          );
        }
        this.cachedLinearSearchFieldsList = null;
        this.normalizedValuesCache.clear();
        this.combinedNormalizedValuesCache = null;
        this.clearPreviousSearchState();
        return;
    }
  }

  private addItemsToField(
    field: keyof T & string,
    items: T[],
    startIndex: number,
  ): void {
    const index = this.flatIndexes.get(field as string);
    if (!index) return;

    const { ngramMap, normalizedValues } = index;

    for (let itemOffset = 0; itemOffset < items.length; itemOffset++) {
      const rawValue = items[itemOffset][field];
      if (typeof rawValue !== "string") {
        continue;
      }

      const lowerValue = rawValue.toLowerCase();
      const datasetIndex = startIndex + itemOffset;
      normalizedValues[datasetIndex] = lowerValue;
      indexLowerValue(ngramMap, lowerValue, datasetIndex);
    }

    index.version = this.state.getMutationVersion();
  }

  private applyUpdatedItem(index: number, previousItem: T, nextItem: T): void {
    for (const field of this.indexedFields) {
      this.updateIndexedField(field, index, previousItem, nextItem);
    }

    this.nestedCollection.updateItem(nextItem, previousItem, index);
  }

  private applyRemovedItem(
    removedItem: T,
    removedIndex: number,
    movedItem: T | null,
    movedFromIndex: number | null,
  ): void {
    for (const field of this.indexedFields) {
      this.removeIndexedFieldValue(field, removedItem, removedIndex);

      if (movedItem !== null && movedFromIndex !== null) {
        this.moveIndexedFieldValue(
          field,
          movedItem,
          movedFromIndex,
          removedIndex,
        );
      }
    }

    this.nestedCollection.removeItem(removedItem, removedIndex);

    if (movedItem !== null && movedFromIndex !== null) {
      this.nestedCollection.moveItem(movedItem, movedFromIndex, removedIndex);
    }
  }

  private updateIndexedField(
    field: keyof T & string,
    itemIndex: number,
    previousItem: T,
    nextItem: T,
  ): void {
    const index = this.flatIndexes.get(field as string);
    if (!index) return;

    if (previousItem[field] === nextItem[field]) {
      index.version = this.state.getMutationVersion();
      return;
    }

    const { ngramMap, normalizedValues } = index;
    const previousLowerValue = this.getNormalizedFieldValue(
      previousItem,
      field,
    );

    if (previousLowerValue) {
      removeLowerValue(ngramMap, previousLowerValue, itemIndex);
    }

    const nextLowerValue = this.getNormalizedFieldValue(nextItem, field);

    if (!nextLowerValue) {
      delete normalizedValues[itemIndex];
      index.version = this.state.getMutationVersion();
      return;
    }

    normalizedValues[itemIndex] = nextLowerValue;
    indexLowerValue(ngramMap, nextLowerValue, itemIndex);
    index.version = this.state.getMutationVersion();
  }

  private removeIndexedFieldValue(
    field: keyof T & string,
    item: T,
    itemIndex: number,
  ): void {
    const index = this.flatIndexes.get(field as string);
    if (!index) return;

    const { ngramMap, normalizedValues } = index;
    const lowerValue = this.getNormalizedFieldValue(item, field);

    if (lowerValue) {
      removeLowerValue(ngramMap, lowerValue, itemIndex);
    }

    delete normalizedValues[itemIndex];
    index.version = this.state.getMutationVersion();
  }

  private moveIndexedFieldValue(
    field: keyof T & string,
    item: T,
    fromIndex: number,
    toIndex: number,
  ): void {
    if (fromIndex === toIndex) return;

    const index = this.flatIndexes.get(field as string);
    if (!index) return;

    const { ngramMap, normalizedValues } = index;
    const lowerValue =
      normalizedValues[fromIndex] ?? this.getNormalizedFieldValue(item, field);

    if (!lowerValue) {
      delete normalizedValues[fromIndex];
      index.version = this.state.getMutationVersion();
      return;
    }

    removeLowerValue(ngramMap, lowerValue, fromIndex);
    indexLowerValue(ngramMap, lowerValue, toIndex);
    normalizedValues[toIndex] = lowerValue;
    delete normalizedValues[fromIndex];
    index.version = this.state.getMutationVersion();
  }

  private getNormalizedFieldValue(
    item: T,
    field: keyof T & string,
  ): string | null {
    const rawValue = item[field];
    return typeof rawValue === "string" ? rawValue.toLowerCase() : null;
  }
}
