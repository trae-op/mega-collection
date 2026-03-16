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
  TextSearchEngineOptions,
} from "./types";
import {
  buildIntersectionQueryGrams,
  MINIMUM_INDEXED_QUERY_LENGTH,
  indexLowerValue,
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

const createSearchRuntime = <T extends CollectionItem>(): SearchRuntime<T> => ({
  indexedFields: new Set<keyof T & string>(),
  flatIndexes: new Map<string, SearchIndex>(),
  nestedStorage: {
    ngramIndexes: new Map<string, Map<string, Set<number>>>(),
    normalizedFieldValues: new Map<string, string[]>(),
  },
  filterByPreviousResult: false,
  previousResult: null,
  previousResultIndices: null,
  previousResultLookup: null,
  previousQuery: null,
});

export class TextSearchEngine<T extends CollectionItem> {
  private readonly state: State<T>;

  private readonly namespace: string;

  private readonly nestedCollection: SearchNestedCollection<T>;

  private readonly minQueryLength: number;

  private cachedIndexedFieldsList: string[] | null = null;

  private cachedLinearSearchFieldsList: string[] | null = null;

  /**
   * Lightweight normalizedValues-only cache for fields without n-gram index.
   * Built lazily on first full-dataset linear scan for non-indexed fields.
   */
  private normalizedValuesCache = new Map<string, string[]>();

  /**
   * Creates a new TextSearchEngine with optional data and fields to index.
   */
  constructor(options: TextSearchEngineOptions<T> & { state?: State<T> } = {}) {
    this.minQueryLength = options.minQueryLength ?? 1;
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

  private rebuildConfiguredIndexes(): void {
    this.flatIndexes.clear();
    this.nestedCollection.clearIndexes();
    this.cachedIndexedFieldsList = null;
    this.cachedLinearSearchFieldsList = null;
    this.normalizedValuesCache.clear();

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

    return this.createLookup(indices);
  }

  /**
   * Returns the data source for search based on filterByPreviousResult setting.
   * When the new query narrows the previous one, returns previousResult with indices.
   * Otherwise resets previous state and returns the full dataset.
   */
  private getSearchSource(lowerQuery: string): {
    data: T[];
    indices: number[] | null;
  } {
    const { runtime } = this;
    if (!runtime.filterByPreviousResult) {
      return { data: this.dataset, indices: null };
    }

    if (
      runtime.previousResult !== null &&
      runtime.previousQuery !== null &&
      lowerQuery.includes(runtime.previousQuery)
    ) {
      return {
        data: runtime.previousResult,
        indices: runtime.previousResultIndices,
      };
    }

    runtime.previousResult = null;
    runtime.previousResultIndices = null;
    runtime.previousResultLookup = null;
    runtime.previousQuery = null;
    return { data: this.dataset, indices: null };
  }

  /**
   * Saves the search result for potential reuse on subsequent narrowing queries.
   */
  private saveSearchResult(items: T[], indices: number[], query: string): void {
    const { runtime } = this;
    if (!runtime.filterByPreviousResult) return;

    runtime.previousResult = items;
    runtime.previousResultIndices = indices;
    runtime.previousResultLookup = this.createLookup(indices);
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

    this.saveSearchResult(result.items, result.indices, lowerQuery);
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

  private clearPreviousSearchState(): void {
    const { runtime } = this;
    runtime.previousResult = null;
    runtime.previousResultIndices = null;
    runtime.previousResultLookup = null;
    runtime.previousQuery = null;
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

    if (window.limit === 0) {
      return [];
    }

    if (!lowerQuery || lowerQuery.length < this.minQueryLength) {
      return this.sliceItems(this.dataset, window);
    }

    const shouldTrack = this.shouldTrackPreviousResult(window);
    const { data: source, indices: sourceIndices } =
      this.getSearchSource(lowerQuery);

    if (source !== this.dataset) {
      if (
        sourceIndices !== null &&
        sourceIndices.length > 0 &&
        !this.nestedCollection.hasRegisteredFields() &&
        this.flatIndexes.size > 0 &&
        lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH
      ) {
        const uniqueQueryGrams = this.getQueryGrams(lowerQuery);
        if (uniqueQueryGrams === null) {
          return [];
        }

        const result = this.searchAllFieldsIndexed(
          lowerQuery,
          uniqueQueryGrams,
          window,
          this.getRestrictionLookup(sourceIndices),
        );
        this.persistSearchResult(result, lowerQuery, shouldTrack);
        return result.items;
      }

      const result = this.searchLinearAllFields(
        source,
        lowerQuery,
        sourceIndices,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    if (!this.flatIndexes.size && !this.nestedCollection.hasIndexes()) {
      const result = this.searchLinearAllFields(
        source,
        lowerQuery,
        null,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    if (lowerQuery.length < MINIMUM_INDEXED_QUERY_LENGTH) {
      const result = this.searchLinearAllFields(
        source,
        lowerQuery,
        null,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    const uniqueQueryGrams = this.getQueryGrams(lowerQuery);
    if (uniqueQueryGrams === null) {
      return [];
    }

    const result = this.searchAllFieldsIndexed(
      lowerQuery,
      uniqueQueryGrams,
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
  ): SearchResult<T> {
    const dataset = this.dataset;
    const seen = new Uint8Array(dataset.length);
    const combined: T[] = [];
    const combinedIndices: number[] = [];
    let matchedCount = 0;

    for (const field of this.flatIndexes.keys()) {
      const indices = this.searchFieldWithPreparedQueryIndices(
        field,
        lowerQuery,
        uniqueQueryGrams,
        restrictionLookup,
      );

      for (let index = 0; index < indices.length; index++) {
        const datasetIndex = indices[index];
        if (seen[datasetIndex]) continue;

        seen[datasetIndex] = 1;
        if (matchedCount < window.offset) {
          matchedCount += 1;
          continue;
        }

        const item = dataset[datasetIndex];
        if (!item) continue;

        combined.push(item);
        combinedIndices.push(datasetIndex);
        matchedCount += 1;

        if (this.hasReachedWindowLimit(window, combined.length)) {
          return { items: combined, indices: combinedIndices };
        }
      }
    }

    if (restrictionLookup !== null) {
      return { items: combined, indices: combinedIndices };
    }

    for (const datasetIndex of this.nestedCollection.searchAllIndexedFieldIndices(
      lowerQuery,
      uniqueQueryGrams,
    )) {
      if (seen[datasetIndex]) continue;

      seen[datasetIndex] = 1;
      if (matchedCount < window.offset) {
        matchedCount += 1;
        continue;
      }

      const item = dataset[datasetIndex];
      if (!item) continue;

      combined.push(item);
      combinedIndices.push(datasetIndex);
      matchedCount += 1;

      if (this.hasReachedWindowLimit(window, combined.length)) {
        return { items: combined, indices: combinedIndices };
      }
    }

    return { items: combined, indices: combinedIndices };
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

    if (window.limit === 0) {
      return [];
    }

    if (!lowerQuery || lowerQuery.length < this.minQueryLength) {
      return this.sliceItems(this.dataset, window);
    }

    const shouldTrack = this.shouldTrackPreviousResult(window);
    const { data: source, indices: sourceIndices } =
      this.getSearchSource(lowerQuery);

    if (source !== this.dataset) {
      const isNested = this.nestedCollection.hasField(field);

      if (
        !isNested &&
        sourceIndices !== null &&
        sourceIndices.length > 0 &&
        lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH &&
        this.flatIndexes.has(field)
      ) {
        const uniqueQueryGrams = this.getQueryGrams(lowerQuery);
        if (uniqueQueryGrams === null) {
          return [];
        }

        const result = this.searchFieldWithPreparedQuery(
          field,
          lowerQuery,
          uniqueQueryGrams,
          window,
          this.getRestrictionLookup(sourceIndices),
        );
        this.persistSearchResult(result, lowerQuery, shouldTrack);
        return result.items;
      }

      if (isNested) {
        const items = this.nestedCollection.searchFieldLinear(
          source,
          field,
          lowerQuery,
        );
        const result = {
          items: this.sliceItems(items, window),
          indices: [] as number[],
        };
        this.persistSearchResult(result, lowerQuery, shouldTrack);
        return result.items;
      }

      const result = this.searchLinearSingleField(
        source,
        field,
        lowerQuery,
        sourceIndices,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    if (this.nestedCollection.hasField(field)) {
      if (
        lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH &&
        this.nestedCollection.hasIndexes()
      ) {
        const uniqueQueryGrams = this.getQueryGrams(lowerQuery);
        if (uniqueQueryGrams === null) {
          return [];
        }

        const items = this.nestedCollection.searchIndexedField(
          this.dataset,
          field,
          lowerQuery,
          uniqueQueryGrams,
        );
        const result = {
          items: this.sliceItems(items, window),
          indices: [] as number[],
        };
        this.persistSearchResult(result, lowerQuery, shouldTrack);
        return result.items;
      }

      const items = this.nestedCollection.searchFieldLinear(
        this.dataset,
        field,
        lowerQuery,
      );
      const result = {
        items: this.sliceItems(items, window),
        indices: [] as number[],
      };
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

    if (
      this.flatIndexes.size > 0 &&
      lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH
    ) {
      const uniqueQueryGrams = this.getQueryGrams(lowerQuery);
      if (uniqueQueryGrams === null) {
        return [];
      }

      const result = this.searchFieldWithPreparedQuery(
        field,
        lowerQuery,
        uniqueQueryGrams,
        window,
      );
      this.persistSearchResult(result, lowerQuery, shouldTrack);
      return result.items;
    }

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
  ): SearchResult<T> {
    const indices = this.searchFieldWithPreparedQueryIndices(
      field,
      lowerQuery,
      uniqueQueryGrams,
      restrictionLookup,
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
    take = Number.POSITIVE_INFINITY,
  ): number[] {
    const currentVersion = this.state.getMutationVersion();
    let index = this.flatIndexes.get(field);

    if (index && index.version !== currentVersion && this.dataset.length > 0) {
      this.buildIndexFromData(this.dataset, field as keyof T & string);
      index = this.flatIndexes.get(field)!;
    }

    if (!index) return [];

    const { ngramMap, normalizedValues } = index;

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
    const matchedItems: T[] = [];
    const matchedIndices: number[] = [];
    let matchedCount = 0;

    if (sourceIndices !== null) {
      const dataset = this.dataset;

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

        matchedItems.push(item);
        matchedIndices.push(datasetIndex);
        matchedCount += 1;

        if (this.hasReachedWindowLimit(window, matchedItems.length)) {
          break;
        }
      }

      return { items: matchedItems, indices: matchedIndices };
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

      matchedItems.push(item);
      matchedIndices.push(itemIndex);
      matchedCount += 1;

      if (this.hasReachedWindowLimit(window, matchedItems.length)) {
        break;
      }
    }

    return { items: matchedItems, indices: matchedIndices };
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
      return {
        items: this.sliceItems(
          this.nestedCollection.searchFieldLinear(data, field, lowerQuery),
          window,
        ),
        indices: [],
      };
    }

    const matchedItems: T[] = [];
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

      for (
        let sourceIndex = 0;
        sourceIndex < sourceIndices.length;
        sourceIndex++
      ) {
        const datasetIndex = sourceIndices[sourceIndex];
        const item = dataset[datasetIndex];

        const isMatch = normValues
          ? Boolean(normValues[datasetIndex]?.includes(lowerQuery))
          : typeof item[field] === "string" &&
            item[field].toLowerCase().includes(lowerQuery);

        if (!isMatch) {
          continue;
        }

        if (matchedCount < window.offset) {
          matchedCount += 1;
          continue;
        }

        matchedItems.push(item);
        matchedIndices.push(datasetIndex);
        matchedCount += 1;

        if (this.hasReachedWindowLimit(window, matchedItems.length)) {
          break;
        }
      }

      return { items: matchedItems, indices: matchedIndices };
    }

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const isMatch = normValues
        ? Boolean(normValues[itemIndex]?.includes(lowerQuery))
        : typeof data[itemIndex][field] === "string" &&
          data[itemIndex][field].toLowerCase().includes(lowerQuery);

      if (!isMatch) {
        continue;
      }

      if (matchedCount < window.offset) {
        matchedCount += 1;
        continue;
      }

      matchedItems.push(data[itemIndex]);
      matchedIndices.push(itemIndex);
      matchedCount += 1;

      if (this.hasReachedWindowLimit(window, matchedItems.length)) {
        break;
      }
    }

    return { items: matchedItems, indices: matchedIndices };
  }

  clearIndexes(): this {
    this.flatIndexes.clear();
    this.nestedCollection.clearIndexes();
    this.normalizedValuesCache.clear();
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
        this.rebuildConfiguredIndexes();
        this.clearPreviousSearchState();
        return;
      case "clearData":
        this.flatIndexes.clear();
        this.nestedCollection.clearIndexes();
        this.cachedLinearSearchFieldsList = null;
        this.normalizedValuesCache.clear();
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
