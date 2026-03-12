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
import type { TextSearchEngineOptions } from "./types";
import { TextSearchEngineError } from "./errors";
import {
  buildIntersectionQueryGrams,
  indexLowerValue,
  removeLowerValue,
} from "./ngram";
import { SearchNestedCollection } from "./nested";

export class TextSearchEngine<T extends CollectionItem> {
  private ngramIndexes = new Map<string, Map<string, Set<number>>>();

  private normalizedFieldValues = new Map<string, string[]>();

  private dataset: T[] = [];

  private readonly state: State<T>;

  private readonly indexedFields = new Set<keyof T & string>();

  private readonly nestedCollection = new SearchNestedCollection<T>();

  private readonly minQueryLength: number;

  /**
   * Creates a new TextSearchEngine with optional data and fields to index.
   */
  constructor(options: TextSearchEngineOptions<T> & { state?: State<T> } = {}) {
    this.minQueryLength = options.minQueryLength ?? 1;
    this.nestedCollection.registerFields(options.nestedFields);
    this.state = options.state ?? new State(options.data ?? []);
    this.dataset = this.state.getOriginData();
    this.state.subscribe((mutation) => this.handleStateMutation(mutation));

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

  private rebuildConfiguredIndexes(): void {
    this.ngramIndexes.clear();
    this.normalizedFieldValues.clear();
    this.nestedCollection.clearIndexes();

    for (const field of this.indexedFields) {
      this.buildIndex(this.dataset, field);
    }

    if (this.nestedCollection.hasRegisteredFields()) {
      this.nestedCollection.buildIndexes(this.dataset);
    }
  }

  /**
   * Builds an n-gram index for the given field.
   */
  private buildIndex(data: T[], field: keyof T & string): this;
  private buildIndex(field: keyof T & string): this;
  private buildIndex(
    dataOrField: T[] | (keyof T & string),
    field?: keyof T & string,
  ): this {
    let data: T[];
    let resolvedField: keyof T & string;

    if (!Array.isArray(dataOrField)) {
      if (!this.dataset.length) {
        throw TextSearchEngineError.missingDatasetForBuildIndex();
      }

      data = this.dataset;
      resolvedField = dataOrField;
    } else {
      data = dataOrField;
      resolvedField = field!;
    }

    this.dataset = data;

    const ngramMap = new Map<string, Set<number>>();
    const normalizedValues = new Array<string>(data.length);

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const rawValue = data[itemIndex][resolvedField];
      if (typeof rawValue !== "string") continue;

      const lower = rawValue.toLowerCase();
      normalizedValues[itemIndex] = lower;
      indexLowerValue(ngramMap, lower, itemIndex);
    }

    this.ngramIndexes.set(resolvedField as string, ngramMap);
    this.normalizedFieldValues.set(resolvedField as string, normalizedValues);
    return this;
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
   * Searches all indexed fields.
   */
  private searchAllFields(query: string): T[] {
    const lowerQuery = this.normalizeQuery(query);

    if (!lowerQuery) {
      return this.dataset;
    }

    if (lowerQuery.length < this.minQueryLength) {
      return this.dataset;
    }

    if (!this.ngramIndexes.size && !this.nestedCollection.hasIndexes()) {
      return this.searchAllFieldsLinear(lowerQuery);
    }

    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    if (!uniqueQueryGrams.size) return [];

    const seenItems = new Set<T>();
    const combined: T[] = [];

    for (const field of this.ngramIndexes.keys()) {
      for (const item of this.searchFieldWithPreparedQuery(
        field,
        lowerQuery,
        uniqueQueryGrams,
      )) {
        if (!seenItems.has(item)) {
          seenItems.add(item);
          combined.push(item);
        }
      }
    }

    for (const item of this.nestedCollection.searchAllIndexedFields(
      this.dataset,
      lowerQuery,
      uniqueQueryGrams,
    )) {
      if (seenItems.has(item)) continue;

      seenItems.add(item);
      combined.push(item);
    }

    return combined;
  }

  /**
   * Searches a specific field.
   */
  private searchField(field: string, query: string): T[] {
    const lowerQuery = this.normalizeQuery(query);

    if (!lowerQuery) return this.dataset;

    if (lowerQuery.length < this.minQueryLength) return this.dataset;

    if (this.nestedCollection.hasField(field)) {
      const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
      if (!uniqueQueryGrams.size) return [];

      if (this.nestedCollection.hasIndexes()) {
        return this.nestedCollection.searchIndexedField(
          this.dataset,
          field,
          lowerQuery,
          uniqueQueryGrams,
        );
      }

      return this.nestedCollection.searchFieldLinear(
        this.dataset,
        field,
        lowerQuery,
      );
    }

    if (!this.ngramIndexes.size) {
      return this.searchFieldLinear(field, lowerQuery);
    }

    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    if (!uniqueQueryGrams.size) return [];

    return this.searchFieldWithPreparedQuery(
      field,
      lowerQuery,
      uniqueQueryGrams,
    );
  }

  /**
   * Searches a field using prepared query grams.
   */
  private searchFieldWithPreparedQuery(
    field: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
  ): T[] {
    const ngramMap = this.ngramIndexes.get(field);
    if (!ngramMap) return [];

    const postingLists: Set<number>[] = [];

    for (const queryGram of uniqueQueryGrams) {
      const postingList = ngramMap.get(queryGram);
      if (!postingList) return [];
      postingLists.push(postingList);
    }

    postingLists.sort(
      (leftPostingList, rightPostingList) =>
        leftPostingList.size - rightPostingList.size,
    );

    const smallestPostingList = postingLists[0];
    const totalPostingLists = postingLists.length;
    const matchedItems: T[] = [];
    const normalizedValues = this.normalizedFieldValues.get(field);

    for (const candidateIndex of smallestPostingList) {
      let isCandidate = true;
      for (let listIndex = 1; listIndex < totalPostingLists; listIndex++) {
        if (!postingLists[listIndex].has(candidateIndex)) {
          isCandidate = false;
          break;
        }
      }
      if (!isCandidate) continue;

      const candidateItem = this.dataset[candidateIndex];
      if (!candidateItem) continue;

      const normalizedValue = normalizedValues?.[candidateIndex];
      if (normalizedValue?.includes(lowerQuery)) {
        matchedItems.push(candidateItem);
      }
    }

    return matchedItems;
  }

  /**
   * Searches all fields linearly without index.
   */
  private searchAllFieldsLinear(lowerQuery: string): T[] {
    if (!this.dataset.length) return [];

    const matchedItems: T[] = [];

    for (let itemIndex = 0; itemIndex < this.dataset.length; itemIndex++) {
      const item = this.dataset[itemIndex];
      let hasMatch = false;

      for (const field in item) {
        const value = item[field];
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
  private searchFieldLinear(field: string, lowerQuery: string): T[] {
    if (!this.dataset.length) return [];

    if (this.nestedCollection.hasField(field)) {
      return this.nestedCollection.searchFieldLinear(
        this.dataset,
        field,
        lowerQuery,
      );
    }

    const matchedItems: T[] = [];

    for (let itemIndex = 0; itemIndex < this.dataset.length; itemIndex++) {
      const fieldValue = this.dataset[itemIndex][field];
      if (typeof fieldValue !== "string") continue;
      if (!fieldValue.toLowerCase().includes(lowerQuery)) continue;
      matchedItems.push(this.dataset[itemIndex]);
    }

    return matchedItems;
  }

  clearIndexes(): this {
    this.ngramIndexes.clear();
    this.normalizedFieldValues.clear();
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

  private applyAddedItems(items: T[], appendToDataset: boolean): this {
    if (items.length === 0) {
      return this;
    }

    const startIndex = appendToDataset
      ? this.dataset.length
      : this.dataset.length - items.length;

    if (appendToDataset) {
      this.dataset.push(...items);
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
        this.applyAddedItems(mutation.items, false);
        return;
      case "update":
        this.applyUpdatedItem(
          mutation.index,
          mutation.previousItem,
          mutation.nextItem,
        );
        return;
      case "data":
        this.dataset = mutation.data;
        this.rebuildConfiguredIndexes();
        return;
      case "clearData":
        this.dataset = mutation.data;
        this.ngramIndexes.clear();
        this.normalizedFieldValues.clear();
        this.nestedCollection.clearIndexes();
        return;
      case "remove":
        this.applyRemovedItem(
          mutation.removedItem,
          mutation.removedIndex,
          mutation.movedItem,
          mutation.movedFromIndex,
        );
        return;
    }
  }

  private addItemsToField(
    field: keyof T & string,
    items: T[],
    startIndex: number,
  ): void {
    const ngramMap = this.ngramIndexes.get(field as string);
    if (!ngramMap) {
      return;
    }

    const normalizedValues =
      this.normalizedFieldValues.get(field as string) ?? [];

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

    this.normalizedFieldValues.set(field as string, normalizedValues);
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
    const ngramMap = this.ngramIndexes.get(field as string);

    if (!ngramMap) {
      return;
    }

    const normalizedValues =
      this.normalizedFieldValues.get(field as string) ?? [];
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
      this.normalizedFieldValues.set(field as string, normalizedValues);
      return;
    }

    normalizedValues[itemIndex] = nextLowerValue;
    indexLowerValue(ngramMap, nextLowerValue, itemIndex);
    this.normalizedFieldValues.set(field as string, normalizedValues);
  }

  private removeIndexedFieldValue(
    field: keyof T & string,
    item: T,
    itemIndex: number,
  ): void {
    const ngramMap = this.ngramIndexes.get(field as string);

    if (!ngramMap) {
      return;
    }

    const normalizedValues =
      this.normalizedFieldValues.get(field as string) ?? [];
    const lowerValue = this.getNormalizedFieldValue(item, field);

    if (lowerValue) {
      removeLowerValue(ngramMap, lowerValue, itemIndex);
    }

    delete normalizedValues[itemIndex];
    this.normalizedFieldValues.set(field as string, normalizedValues);
  }

  private moveIndexedFieldValue(
    field: keyof T & string,
    item: T,
    fromIndex: number,
    toIndex: number,
  ): void {
    if (fromIndex === toIndex) {
      return;
    }

    const ngramMap = this.ngramIndexes.get(field as string);

    if (!ngramMap) {
      return;
    }

    const normalizedValues =
      this.normalizedFieldValues.get(field as string) ?? [];
    const lowerValue =
      normalizedValues[fromIndex] ?? this.getNormalizedFieldValue(item, field);

    if (!lowerValue) {
      delete normalizedValues[fromIndex];
      this.normalizedFieldValues.set(field as string, normalizedValues);
      return;
    }

    removeLowerValue(ngramMap, lowerValue, fromIndex);
    indexLowerValue(ngramMap, lowerValue, toIndex);
    normalizedValues[toIndex] = lowerValue;
    delete normalizedValues[fromIndex];
    this.normalizedFieldValues.set(field as string, normalizedValues);
  }

  private getNormalizedFieldValue(
    item: T,
    field: keyof T & string,
  ): string | null {
    const rawValue = item[field];
    return typeof rawValue === "string" ? rawValue.toLowerCase() : null;
  }
}
