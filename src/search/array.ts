import { CollectionItem } from "../types";
import { normalizeArrayFieldValue } from "../internal";
import {
  indexLowerValue,
  intersectPostingListsInCandidates,
  intersectPostingLists,
  removeLowerValue,
} from "./ngram";
import type { SearchArrayCollectionStorage } from "./types";

// A NUL separator prevents ordinary text queries, including multiline
// queries, from matching across two adjacent array elements.
const ARRAY_VALUE_SEPARATOR = "\u0000";

export class SearchArrayCollection<T extends CollectionItem> {
  private readonly registeredFields = new Set<string>();

  constructor(
    private readonly storage: SearchArrayCollectionStorage = {
      ngramIndexes: new Map<string, Map<string, Set<number>>>(),
      normalizedFieldValues: new Map<string, string[]>(),
    },
  ) {}

  registerFields(fieldPaths?: readonly string[]): void {
    if (!fieldPaths?.length) return;

    for (const fieldPath of fieldPaths) {
      this.registeredFields.add(fieldPath);
    }
  }

  hasRegisteredFields(): boolean {
    return this.registeredFields.size > 0;
  }

  hasField(field: string): boolean {
    return this.registeredFields.has(field);
  }

  hasIndexes(): boolean {
    return this.storage.ngramIndexes.size > 0;
  }

  clearIndexes(): void {
    this.storage.ngramIndexes.clear();
    this.storage.normalizedFieldValues.clear();
  }

  buildIndexes(data: T[]): void {
    this.clearIndexes();

    for (const field of this.registeredFields) {
      this.buildIndex(data, field);
    }
  }

  addItems(items: T[], startIndex: number): void {
    if (items.length === 0 || this.storage.ngramIndexes.size === 0) {
      return;
    }

    for (const field of this.storage.ngramIndexes.keys()) {
      this.addItemsToField(field, items, startIndex);
    }
  }

  updateItem(item: T, previousItem: T, itemIndex: number): void {
    if (this.storage.ngramIndexes.size === 0) {
      return;
    }

    for (const field of this.storage.ngramIndexes.keys()) {
      this.updateItemInField(field, item, previousItem, itemIndex);
    }
  }

  removeItem(item: T, itemIndex: number): void {
    if (this.storage.ngramIndexes.size === 0) {
      return;
    }

    for (const field of this.storage.ngramIndexes.keys()) {
      this.removeItemFromField(field, item, itemIndex);
    }
  }

  moveItem(item: T, fromIndex: number, toIndex: number): void {
    if (this.storage.ngramIndexes.size === 0 || fromIndex === toIndex) {
      return;
    }

    for (const field of this.storage.ngramIndexes.keys()) {
      this.moveItemForField(field, item, fromIndex, toIndex);
    }
  }

  searchAllIndexedFieldIndices(
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    restrictionLookup?: Uint8Array | null,
    candidateIndices?: readonly number[] | null,
  ): number[] {
    const seenIndices = new Set<number>();
    const matchedIndices: number[] = [];

    for (const field of this.storage.ngramIndexes.keys()) {
      for (const idx of this.searchIndexedFieldIndices(
        field,
        lowerQuery,
        uniqueQueryGrams,
        restrictionLookup,
        candidateIndices,
      )) {
        if (seenIndices.has(idx)) continue;
        seenIndices.add(idx);
        matchedIndices.push(idx);
      }
    }

    return matchedIndices;
  }

  searchIndexedField(
    data: T[],
    field: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    restrictionLookup?: Uint8Array | null,
    candidateIndices?: readonly number[] | null,
    take = Number.POSITIVE_INFINITY,
  ): T[] {
    const indices = this.searchIndexedFieldIndices(
      field,
      lowerQuery,
      uniqueQueryGrams,
      restrictionLookup,
      candidateIndices,
      take,
    );
    const matchedItems: T[] = [];
    for (let i = 0; i < indices.length; i++) {
      const item = data[indices[i]];
      if (item) matchedItems.push(item);
    }
    return matchedItems;
  }

  searchIndexedFieldIndices(
    field: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    restrictionLookup?: Uint8Array | null,
    candidateIndices?: readonly number[] | null,
    take = Number.POSITIVE_INFINITY,
  ): number[] {
    if (lowerQuery.includes(ARRAY_VALUE_SEPARATOR)) return [];

    const ngramMap = this.storage.ngramIndexes.get(field);
    if (!ngramMap) return [];

    const normalizedValues =
      this.storage.normalizedFieldValues.get(field) ?? [];

    if (candidateIndices !== null && candidateIndices !== undefined) {
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

  searchFieldLinear(data: T[], field: string, lowerQuery: string): T[] {
    const indices = this.searchFieldLinearIndices(data, field, lowerQuery);
    const matchedItems: T[] = [];

    for (let index = 0; index < indices.length; index++) {
      const item = data[indices[index]];
      if (item) {
        matchedItems.push(item);
      }
    }

    return matchedItems;
  }

  searchFieldLinearIndices(
    data: T[],
    field: string,
    lowerQuery: string,
    sourceIndices?: readonly number[],
  ): number[] {
    const matchedIndices: number[] = [];

    if (lowerQuery.includes(ARRAY_VALUE_SEPARATOR)) return matchedIndices;

    if (sourceIndices) {
      for (
        let candidateIndex = 0;
        candidateIndex < sourceIndices.length;
        candidateIndex++
      ) {
        const itemIndex = sourceIndices[candidateIndex];
        const item = data[itemIndex];
        const arr = item[field];
        if (!Array.isArray(arr)) continue;

        if (this.arrayContainsLower(arr, lowerQuery)) {
          matchedIndices.push(itemIndex);
        }
      }

      return matchedIndices;
    }

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const arr = data[itemIndex][field];
      if (!Array.isArray(arr)) continue;

      if (this.arrayContainsLower(arr, lowerQuery)) {
        matchedIndices.push(itemIndex);
      }
    }

    return matchedIndices;
  }

  matchesAnyField(item: T, lowerQuery: string): boolean {
    for (const field of this.registeredFields) {
      const arr = item[field];
      if (!Array.isArray(arr)) continue;

      if (this.arrayContainsLower(arr, lowerQuery)) return true;
    }

    return false;
  }

  private arrayContainsLower(arr: unknown[], lowerQuery: string): boolean {
    if (lowerQuery.includes(ARRAY_VALUE_SEPARATOR)) return false;

    for (let i = 0; i < arr.length; i++) {
      const norm = normalizeArrayFieldValue(arr[i]);
      if (norm !== null && norm.includes(lowerQuery)) return true;
    }
    return false;
  }

  private getNormalizedValues(field: string): string[] {
    const existing = this.storage.normalizedFieldValues.get(field);
    if (existing) return existing;

    const created: string[] = [];
    this.storage.normalizedFieldValues.set(field, created);
    return created;
  }

  private buildIndex(data: T[], field: string): void {
    const ngramMap = new Map<string, Set<number>>();
    const normalizedFieldValues = new Array<string>(data.length);

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const arr = data[itemIndex][field];
      if (!Array.isArray(arr)) continue;

      const normalizedValues: string[] = [];

      for (let i = 0; i < arr.length; i++) {
        const norm = normalizeArrayFieldValue(arr[i]);
        if (norm !== null) normalizedValues.push(norm);
      }

      if (normalizedValues.length === 0) continue;

      const joinedValue = normalizedValues.join(ARRAY_VALUE_SEPARATOR);
      normalizedFieldValues[itemIndex] = joinedValue;
      indexLowerValue(ngramMap, joinedValue, itemIndex);
    }

    this.storage.ngramIndexes.set(field, ngramMap);
    this.storage.normalizedFieldValues.set(field, normalizedFieldValues);
  }

  private addItemsToField(field: string, items: T[], startIndex: number): void {
    const ngramMap = this.storage.ngramIndexes.get(field);
    if (!ngramMap) return;

    const normalizedFieldValues = this.getNormalizedValues(field);

    for (let itemOffset = 0; itemOffset < items.length; itemOffset++) {
      const item = items[itemOffset];
      const arr = item[field];
      if (!Array.isArray(arr)) continue;

      const normalizedValues: string[] = [];
      const datasetIndex = startIndex + itemOffset;

      for (let i = 0; i < arr.length; i++) {
        const norm = normalizeArrayFieldValue(arr[i]);
        if (norm !== null) normalizedValues.push(norm);
      }

      if (normalizedValues.length === 0) continue;

      const joinedValue = normalizedValues.join(ARRAY_VALUE_SEPARATOR);
      normalizedFieldValues[datasetIndex] = joinedValue;
      indexLowerValue(ngramMap, joinedValue, datasetIndex);
    }
  }

  private updateItemInField(
    field: string,
    item: T,
    previousItem: T,
    itemIndex: number,
  ): void {
    const ngramMap = this.storage.ngramIndexes.get(field);
    if (!ngramMap) return;

    const normalizedFieldValues = this.getNormalizedValues(field);

    const previousNormalizedValue = this.getNormalizedItemValue(
      field,
      previousItem,
    );

    const nextNormalizedValue = this.getNormalizedItemValue(field, item);

    if (previousNormalizedValue === nextNormalizedValue) {
      return;
    }

    if (previousNormalizedValue) {
      removeLowerValue(ngramMap, previousNormalizedValue, itemIndex);
    }

    if (!nextNormalizedValue) {
      delete normalizedFieldValues[itemIndex];
      return;
    }

    normalizedFieldValues[itemIndex] = nextNormalizedValue;
    indexLowerValue(ngramMap, nextNormalizedValue, itemIndex);
  }

  private removeItemFromField(field: string, item: T, itemIndex: number): void {
    const ngramMap = this.storage.ngramIndexes.get(field);
    if (!ngramMap) return;

    const normalizedFieldValues = this.getNormalizedValues(field);

    const normalizedValue =
      normalizedFieldValues[itemIndex] ??
      this.getNormalizedItemValue(field, item);

    if (normalizedValue) {
      removeLowerValue(ngramMap, normalizedValue, itemIndex);
    }

    delete normalizedFieldValues[itemIndex];
  }

  private moveItemForField(
    field: string,
    item: T,
    fromIndex: number,
    toIndex: number,
  ): void {
    const ngramMap = this.storage.ngramIndexes.get(field);
    if (!ngramMap) return;

    const normalizedFieldValues = this.getNormalizedValues(field);

    const normalizedValue =
      normalizedFieldValues[fromIndex] ??
      this.getNormalizedItemValue(field, item);

    if (!normalizedValue) {
      delete normalizedFieldValues[fromIndex];
      return;
    }

    removeLowerValue(ngramMap, normalizedValue, fromIndex);
    indexLowerValue(ngramMap, normalizedValue, toIndex);
    normalizedFieldValues[toIndex] = normalizedValue;
    delete normalizedFieldValues[fromIndex];
  }

  private getNormalizedItemValue(field: string, item: T): string | null {
    const arr = item[field];
    if (!Array.isArray(arr)) return null;

    const normalizedValues: string[] = [];

    for (let i = 0; i < arr.length; i++) {
      const norm = normalizeArrayFieldValue(arr[i]);
      if (norm !== null) normalizedValues.push(norm);
    }

    if (normalizedValues.length === 0) return null;

    return normalizedValues.join(ARRAY_VALUE_SEPARATOR);
  }
}
