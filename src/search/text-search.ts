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
  previousQuery: null,
});

export class TextSearchEngine<T extends CollectionItem> {
  private readonly state: State<T>;

  private readonly namespace: string;

  private readonly nestedCollection: SearchNestedCollection<T>;

  private readonly minQueryLength: number;

  private cachedIndexedFieldsList: string[] | null = null;

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

  search(query: string): T[];
  search(field: (keyof T & string) | (string & {}), query: string): T[];
  search(fieldOrQuery: string, maybeQuery?: string): T[] {
    if (maybeQuery === undefined) {
      return this.searchAllFields(fieldOrQuery);
    }

    return this.searchField(fieldOrQuery, maybeQuery);
  }

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
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
    runtime.previousQuery = query;
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
    runtime.previousQuery = null;
  }

  /**
   * Searches all indexed fields.
   */
  private searchAllFields(query: string): T[] {
    const lowerQuery = this.normalizeQuery(query);

    if (!lowerQuery || lowerQuery.length < this.minQueryLength) {
      return this.dataset;
    }

    const { data: source, indices: sourceIndices } =
      this.getSearchSource(lowerQuery);

    // Narrowing on previous result — use index-aware linear scan over stored indices.
    if (source !== this.dataset) {
      const result = this.searchLinearAllFields(
        source,
        lowerQuery,
        sourceIndices,
      );
      this.saveSearchResult(result.items, result.indices, lowerQuery);
      return result.items;
    }

    // No flat or nested indexes — linear fallback on full dataset.
    if (!this.flatIndexes.size && !this.nestedCollection.hasIndexes()) {
      const result = this.searchLinearAllFields(source, lowerQuery, null);
      this.saveSearchResult(result.items, result.indices, lowerQuery);
      return result.items;
    }

    // Query too short for trigram index — linear fallback on full dataset.
    if (lowerQuery.length < MINIMUM_INDEXED_QUERY_LENGTH) {
      const result = this.searchLinearAllFields(source, lowerQuery, null);
      this.saveSearchResult(result.items, result.indices, lowerQuery);
      return result.items;
    }

    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    if (!uniqueQueryGrams.size) return [];

    // O3: Uint8Array dedup — avoids Set<T> heap allocation and hash overhead.
    const seen = new Uint8Array(this.dataset.length);
    const combined: T[] = [];
    const combinedIndices: number[] = [];

    for (const field of this.flatIndexes.keys()) {
      for (const idx of this.searchFieldWithPreparedQueryIndices(
        field,
        lowerQuery,
        uniqueQueryGrams,
      )) {
        if (seen[idx]) continue;
        seen[idx] = 1;
        combined.push(this.dataset[idx]);
        combinedIndices.push(idx);
      }
    }

    for (const idx of this.nestedCollection.searchAllIndexedFieldIndices(
      lowerQuery,
      uniqueQueryGrams,
    )) {
      if (seen[idx]) continue;
      seen[idx] = 1;
      combined.push(this.dataset[idx]);
      combinedIndices.push(idx);
    }

    this.saveSearchResult(combined, combinedIndices, lowerQuery);
    return combined;
  }

  /**
   * Searches a specific field.
   */
  private searchField(field: string, query: string): T[] {
    const lowerQuery = this.normalizeQuery(query);

    if (!lowerQuery || lowerQuery.length < this.minQueryLength)
      return this.dataset;

    const { data: source, indices: sourceIndices } =
      this.getSearchSource(lowerQuery);

    // Narrowing on previous result — linear scan with optional index lookups.
    if (source !== this.dataset) {
      const isNested = this.nestedCollection.hasField(field);

      if (isNested) {
        const result = this.nestedCollection.searchFieldLinear(
          source,
          field,
          lowerQuery,
        );
        this.saveSearchResult(result, [], lowerQuery);
        return result;
      }

      const result = this.searchLinearSingleField(
        source,
        field,
        lowerQuery,
        sourceIndices,
      );
      this.saveSearchResult(result.items, result.indices, lowerQuery);
      return result.items;
    }

    // Nested field — delegate to nested collection.
    if (this.nestedCollection.hasField(field)) {
      if (
        lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH &&
        this.nestedCollection.hasIndexes()
      ) {
        const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
        if (!uniqueQueryGrams.size) return [];

        const result = this.nestedCollection.searchIndexedField(
          this.dataset,
          field,
          lowerQuery,
          uniqueQueryGrams,
        );
        this.saveSearchResult(result, [], lowerQuery);
        return result;
      }

      const result = this.nestedCollection.searchFieldLinear(
        this.dataset,
        field,
        lowerQuery,
      );
      this.saveSearchResult(result, [], lowerQuery);
      return result;
    }

    // Flat field — use index when possible.
    if (
      this.flatIndexes.size > 0 &&
      lowerQuery.length >= MINIMUM_INDEXED_QUERY_LENGTH
    ) {
      const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
      if (!uniqueQueryGrams.size) return [];

      const result = this.searchFieldWithPreparedQuery(
        field,
        lowerQuery,
        uniqueQueryGrams,
      );
      this.saveSearchResult(result.items, result.indices, lowerQuery);
      return result.items;
    }

    // Linear fallback for flat field.
    const result = this.searchLinearSingleField(
      this.dataset,
      field,
      lowerQuery,
      null,
    );
    this.saveSearchResult(result.items, result.indices, lowerQuery);
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
  ): { items: T[]; indices: number[] } {
    const indices = this.searchFieldWithPreparedQueryIndices(
      field,
      lowerQuery,
      uniqueQueryGrams,
    );
    const items: T[] = [];
    for (let i = 0; i < indices.length; i++) {
      const item = this.dataset[indices[i]];
      if (item) items.push(item);
    }
    return { items, indices };
  }

  /**
   * Core indexed search: returns dataset indices of matching items.
   * If the cached index is stale (version mismatch), rebuilds it lazily.
   */
  private searchFieldWithPreparedQueryIndices(
    field: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
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
   * Searches all fields linearly, using pre-normalized values when available.
   * When `sourceIndices` is provided, iterates only those dataset positions
   * (previousResult narrowing path) and resolves items via this.dataset[idx].
   */
  private searchLinearAllFields(
    data: T[],
    lowerQuery: string,
    sourceIndices: number[] | null,
  ): { items: T[]; indices: number[] } {
    if (!data.length) return { items: [], indices: [] };

    const indexedFieldsList = this.getIndexedFieldsList();

    // Use known indexed fields when available; fall back to first-item string keys.
    const fields: string[] =
      indexedFieldsList.length > 0
        ? indexedFieldsList
        : Object.keys(data[0]).filter((k) => typeof data[0][k] === "string");

    // Precompute flat index references to avoid Map.get per-item per-field.
    // For full-dataset scans, eagerly build normalizedValues for unindexed fields.
    const isFullDataset = data === this.dataset;
    const fieldCount = fields.length;
    const fieldNormValues: (string[] | null)[] = new Array(fieldCount);
    for (let f = 0; f < fieldCount; f++) {
      const fieldName = fields[f];
      const flatIndex = this.flatIndexes.get(fieldName);

      if (flatIndex) {
        fieldNormValues[f] = flatIndex.normalizedValues;
      } else {
        const cached = this.normalizedValuesCache.get(fieldName);
        if (cached) {
          fieldNormValues[f] = cached;
        } else if (isFullDataset) {
          fieldNormValues[f] = this.buildNormalizedValuesOnly(data, fieldName);
        } else {
          fieldNormValues[f] = null;
        }
      }
    }

    const hasNestedFields = this.nestedCollection.hasRegisteredFields();
    const matchedItems: T[] = [];
    const matchedIndices: number[] = [];

    // When we have sourceIndices, iterate the stored dataset positions to use
    // normalizedValues lookups instead of toLowerCase() on each item.
    if (sourceIndices !== null) {
      const dataset = this.dataset;

      for (let si = 0; si < sourceIndices.length; si++) {
        const datasetIdx = sourceIndices[si];
        const item = dataset[datasetIdx];
        let hasMatch = false;

        for (let f = 0; f < fieldCount; f++) {
          const normValues = fieldNormValues[f];

          if (normValues) {
            const norm = normValues[datasetIdx];
            if (norm && norm.includes(lowerQuery)) {
              hasMatch = true;
              break;
            }
          } else {
            const value = item[fields[f]];
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

        if (hasMatch) {
          matchedItems.push(item);
          matchedIndices.push(datasetIdx);
        }
      }

      return { items: matchedItems, indices: matchedIndices };
    }

    // Full-dataset scan — use precomputed normalizedValues when available.
    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      let hasMatch = false;

      for (let f = 0; f < fieldCount; f++) {
        const normValues = fieldNormValues[f];

        if (normValues) {
          const norm = normValues[itemIndex];
          if (norm && norm.includes(lowerQuery)) {
            hasMatch = true;
            break;
          }
        } else {
          const value = item[fields[f]];
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

      if (hasMatch) {
        matchedItems.push(item);
        matchedIndices.push(itemIndex);
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
  ): { items: T[]; indices: number[] } {
    if (!data.length) return { items: [], indices: [] };

    if (this.nestedCollection.hasField(field)) {
      return {
        items: this.nestedCollection.searchFieldLinear(data, field, lowerQuery),
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

    // Iterate stored dataset positions when narrowing on previousResult.
    if (sourceIndices !== null) {
      const dataset = this.dataset;

      for (let si = 0; si < sourceIndices.length; si++) {
        const datasetIdx = sourceIndices[si];
        const item = dataset[datasetIdx];

        if (normValues) {
          const norm = normValues[datasetIdx];
          if (norm && norm.includes(lowerQuery)) {
            matchedItems.push(item);
            matchedIndices.push(datasetIdx);
          }
        } else {
          const fieldValue = item[field];
          if (
            typeof fieldValue === "string" &&
            fieldValue.toLowerCase().includes(lowerQuery)
          ) {
            matchedItems.push(item);
            matchedIndices.push(datasetIdx);
          }
        }
      }

      return { items: matchedItems, indices: matchedIndices };
    }

    // Full-dataset scan.
    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      if (normValues) {
        const norm = normValues[itemIndex];
        if (norm && norm.includes(lowerQuery)) {
          matchedItems.push(data[itemIndex]);
          matchedIndices.push(itemIndex);
        }
      } else {
        const fieldValue = data[itemIndex][field];
        if (
          typeof fieldValue === "string" &&
          fieldValue.toLowerCase().includes(lowerQuery)
        ) {
          matchedItems.push(data[itemIndex]);
          matchedIndices.push(itemIndex);
        }
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

  private applyAddedItems(items: T[]): this {
    if (items.length === 0) {
      return this;
    }

    const startIndex = this.dataset.length - items.length;

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
        this.applyAddedItems(mutation.items);
        this.normalizedValuesCache.clear();
        this.clearPreviousSearchState();
        return;
      case "update":
        this.applyUpdatedItem(
          mutation.index,
          mutation.previousItem,
          mutation.nextItem,
        );
        this.normalizedValuesCache.clear();
        this.clearPreviousSearchState();
        return;
      case "data":
        this.rebuildConfiguredIndexes();
        this.clearPreviousSearchState();
        return;
      case "clearData":
        this.flatIndexes.clear();
        this.nestedCollection.clearIndexes();
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
