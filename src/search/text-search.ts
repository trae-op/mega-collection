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
  previousQuery: null,
});

export class TextSearchEngine<T extends CollectionItem> {
  private readonly state: State<T>;

  private readonly namespace: string;

  private readonly nestedCollection: SearchNestedCollection<T>;

  private readonly minQueryLength: number;

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
   * When the new query narrows the previous one, returns previousResult.
   * Otherwise resets previous state and returns the full dataset.
   */
  private getSearchSource(lowerQuery: string): T[] {
    const { runtime } = this;
    if (!runtime.filterByPreviousResult) return this.dataset;

    if (
      runtime.previousResult !== null &&
      runtime.previousQuery !== null &&
      lowerQuery.includes(runtime.previousQuery)
    ) {
      return runtime.previousResult;
    }

    runtime.previousResult = null;
    runtime.previousQuery = null;
    return this.dataset;
  }

  /**
   * Saves the search result for potential reuse on subsequent narrowing queries.
   */
  private saveSearchResult(result: T[], query: string): void {
    const { runtime } = this;
    if (!runtime.filterByPreviousResult) return;
    runtime.previousResult = result;
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

    const source = this.getSearchSource(lowerQuery);

    if (source !== this.dataset) {
      const result = this.searchAllFieldsLinear(source, lowerQuery);
      this.saveSearchResult(result, lowerQuery);
      return result;
    }

    if (!this.flatIndexes.size && !this.nestedCollection.hasIndexes()) {
      const result = this.searchAllFieldsLinear(source, lowerQuery);
      this.saveSearchResult(result, lowerQuery);
      return result;
    }

    // Only use the index when the query is long enough to produce a trigram.
    if (lowerQuery.length < MINIMUM_INDEXED_QUERY_LENGTH) {
      const result = this.searchAllFieldsLinear(source, lowerQuery);
      this.saveSearchResult(result, lowerQuery);
      return result;
    }

    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    if (!uniqueQueryGrams.size) return [];

    // O3: Uint8Array dedup — avoids Set<T> heap allocation and hash overhead.
    const seen = new Uint8Array(this.dataset.length);
    const combined: T[] = [];

    for (const field of this.flatIndexes.keys()) {
      for (const idx of this.searchFieldWithPreparedQueryIndices(
        field,
        lowerQuery,
        uniqueQueryGrams,
      )) {
        if (seen[idx]) continue;
        seen[idx] = 1;
        combined.push(this.dataset[idx]);
      }
    }

    for (const idx of this.nestedCollection.searchAllIndexedFieldIndices(
      lowerQuery,
      uniqueQueryGrams,
    )) {
      if (seen[idx]) continue;
      seen[idx] = 1;
      combined.push(this.dataset[idx]);
    }

    this.saveSearchResult(combined, lowerQuery);
    return combined;
  }

  /**
   * Searches a specific field.
   */
  private searchField(field: string, query: string): T[] {
    const lowerQuery = this.normalizeQuery(query);

    if (!lowerQuery || lowerQuery.length < this.minQueryLength)
      return this.dataset;

    const source = this.getSearchSource(lowerQuery);

    if (source !== this.dataset) {
      const result = this.nestedCollection.hasField(field)
        ? this.nestedCollection.searchFieldLinear(source, field, lowerQuery)
        : this.searchFieldLinear(source, field, lowerQuery);
      this.saveSearchResult(result, lowerQuery);
      return result;
    }

    if (this.nestedCollection.hasField(field)) {
      // Only use the index for queries long enough to produce a trigram.
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
        this.saveSearchResult(result, lowerQuery);
        return result;
      }

      const result = this.nestedCollection.searchFieldLinear(
        this.dataset,
        field,
        lowerQuery,
      );
      this.saveSearchResult(result, lowerQuery);
      return result;
    }

    if (
      !this.flatIndexes.size ||
      lowerQuery.length < MINIMUM_INDEXED_QUERY_LENGTH
    ) {
      const result = this.searchFieldLinear(this.dataset, field, lowerQuery);
      this.saveSearchResult(result, lowerQuery);
      return result;
    }

    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    if (!uniqueQueryGrams.size) return [];

    const result = this.searchFieldWithPreparedQuery(
      field,
      lowerQuery,
      uniqueQueryGrams,
    );
    this.saveSearchResult(result, lowerQuery);
    return result;
  }

  /**
   * Searches a field using prepared query grams, returning matched items.
   * Delegates to searchFieldWithPreparedQueryIndices for the core intersection logic.
   */
  private searchFieldWithPreparedQuery(
    field: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
  ): T[] {
    const indices = this.searchFieldWithPreparedQueryIndices(
      field,
      lowerQuery,
      uniqueQueryGrams,
    );
    const result: T[] = [];
    for (let i = 0; i < indices.length; i++) {
      const item = this.dataset[indices[i]];
      if (item) result.push(item);
    }
    return result;
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
    const postingLists: Set<number>[] = [];

    for (const queryGram of uniqueQueryGrams) {
      const postingList = ngramMap.get(queryGram);
      if (!postingList) return [];
      postingLists.push(postingList);
    }

    // O4: find smallest posting list and swap to front — avoids allocating a sort comparator.
    let minIdx = 0;
    for (let i = 1; i < postingLists.length; i++) {
      if (postingLists[i].size < postingLists[minIdx].size) minIdx = i;
    }
    if (minIdx !== 0) {
      const tmp = postingLists[0];
      postingLists[0] = postingLists[minIdx];
      postingLists[minIdx] = tmp;
    }

    const smallestPostingList = postingLists[0];
    const totalPostingLists = postingLists.length;
    const matchedIndices: number[] = [];

    for (const candidateIndex of smallestPostingList) {
      let isCandidate = true;
      for (let listIndex = 1; listIndex < totalPostingLists; listIndex++) {
        if (!postingLists[listIndex].has(candidateIndex)) {
          isCandidate = false;
          break;
        }
      }
      if (!isCandidate) continue;

      if (normalizedValues[candidateIndex]?.includes(lowerQuery)) {
        matchedIndices.push(candidateIndex);
      }
    }

    return matchedIndices;
  }

  /**
   * Searches all fields linearly without index.
   * Uses known indexed fields when available to avoid per-item allocations.
   */
  private searchAllFieldsLinear(data: T[], lowerQuery: string): T[] {
    if (!data.length) return [];

    // Use known indexed fields when available; fall back to first-item string keys.
    const fields: string[] =
      this.indexedFields.size > 0
        ? Array.from(this.indexedFields)
        : Object.keys(data[0]).filter((k) => typeof data[0][k] === "string");

    const matchedItems: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      let hasMatch = false;

      for (let f = 0; f < fields.length; f++) {
        const value = item[fields[f]];
        if (typeof value !== "string") continue;
        if (!value.toLowerCase().includes(lowerQuery)) continue;

        hasMatch = true;
        break;
      }

      if (!hasMatch) {
        hasMatch = this.nestedCollection.matchesAnyField(item, lowerQuery);
      }

      if (hasMatch) {
        matchedItems.push(item);
      }
    }

    return matchedItems;
  }

  /**
   * Searches a specific field linearly without index.
   */
  private searchFieldLinear(data: T[], field: string, lowerQuery: string): T[] {
    if (!data.length) return [];

    if (this.nestedCollection.hasField(field)) {
      return this.nestedCollection.searchFieldLinear(data, field, lowerQuery);
    }

    const matchedItems: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const fieldValue = data[itemIndex][field];
      if (typeof fieldValue !== "string") continue;
      if (!fieldValue.toLowerCase().includes(lowerQuery)) continue;
      matchedItems.push(data[itemIndex]);
    }

    return matchedItems;
  }

  clearIndexes(): this {
    this.flatIndexes.clear();
    this.nestedCollection.clearIndexes();
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
        this.clearPreviousSearchState();
        return;
      case "update":
        this.applyUpdatedItem(
          mutation.index,
          mutation.previousItem,
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
        this.clearPreviousSearchState();
        return;
      case "remove":
        this.applyRemovedItem(
          mutation.removedItem,
          mutation.removedIndex,
          mutation.movedItem,
          mutation.movedFromIndex,
        );
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
