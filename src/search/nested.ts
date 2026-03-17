import { CollectionItem } from "../types";
import {
  indexLowerValue,
  intersectPostingListsInCandidates,
  intersectPostingLists,
  removeLowerValue,
} from "./ngram";
import type {
  NestedFieldDescriptor,
  SearchNestedCollectionStorage,
} from "./types";

export class SearchNestedCollection<T extends CollectionItem> {
  private readonly registeredFields = new Set<string>();

  private readonly fieldDescriptors = new Map<string, NestedFieldDescriptor>();

  constructor(
    private readonly storage: SearchNestedCollectionStorage = {
      ngramIndexes: new Map<string, Map<string, Set<number>>>(),
      normalizedFieldValues: new Map<string, string[]>(),
    },
  ) {}

  registerFields(fieldPaths?: readonly string[]): void {
    if (!fieldPaths?.length) return;

    for (const fieldPath of fieldPaths) {
      this.registerField(fieldPath);
    }
  }

  hasRegisteredFields(): boolean {
    return this.registeredFields.size > 0;
  }

  hasField(fieldPath: string): boolean {
    return this.registeredFields.has(fieldPath);
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

    for (const fieldPath of this.registeredFields) {
      this.buildIndex(data, fieldPath);
    }
  }

  addItems(items: T[], startIndex: number): void {
    if (items.length === 0 || this.storage.ngramIndexes.size === 0) {
      return;
    }

    for (const fieldPath of this.storage.ngramIndexes.keys()) {
      this.addItemsToField(fieldPath, items, startIndex);
    }
  }

  updateItem(item: T, previousItem: T, itemIndex: number): void {
    if (this.storage.ngramIndexes.size === 0) {
      return;
    }

    for (const fieldPath of this.storage.ngramIndexes.keys()) {
      this.updateItemInField(fieldPath, item, previousItem, itemIndex);
    }
  }

  removeItem(item: T, itemIndex: number): void {
    if (this.storage.ngramIndexes.size === 0) {
      return;
    }

    for (const fieldPath of this.storage.ngramIndexes.keys()) {
      this.removeItemFromField(fieldPath, item, itemIndex);
    }
  }

  moveItem(item: T, fromIndex: number, toIndex: number): void {
    if (this.storage.ngramIndexes.size === 0 || fromIndex === toIndex) {
      return;
    }

    for (const fieldPath of this.storage.ngramIndexes.keys()) {
      this.moveItemForField(fieldPath, item, fromIndex, toIndex);
    }
  }

  /**
   * Returns dataset indices of items matching the query across all registered
   * nested fields. Deduplicates indices that appear in multiple nested fields.
   */
  searchAllIndexedFieldIndices(
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    restrictionLookup?: Uint8Array | null,
    candidateIndices?: readonly number[] | null,
  ): number[] {
    const seenIndices = new Set<number>();
    const matchedIndices: number[] = [];

    for (const fieldPath of this.storage.ngramIndexes.keys()) {
      for (const idx of this.searchIndexedFieldIndices(
        fieldPath,
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
    fieldPath: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    restrictionLookup?: Uint8Array | null,
    candidateIndices?: readonly number[] | null,
    take = Number.POSITIVE_INFINITY,
  ): T[] {
    const indices = this.searchIndexedFieldIndices(
      fieldPath,
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

  /**
   * Core indexed search for a nested field: returns dataset indices of items
   * whose nested values match the query.
   */
  searchIndexedFieldIndices(
    fieldPath: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
    restrictionLookup?: Uint8Array | null,
    candidateIndices?: readonly number[] | null,
    take = Number.POSITIVE_INFINITY,
  ): number[] {
    const ngramMap = this.storage.ngramIndexes.get(fieldPath);
    if (!ngramMap) return [];

    const normalizedValues =
      this.storage.normalizedFieldValues.get(fieldPath) ?? [];

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

  searchFieldLinear(data: T[], fieldPath: string, lowerQuery: string): T[] {
    const indices = this.searchFieldLinearIndices(data, fieldPath, lowerQuery);
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
    fieldPath: string,
    lowerQuery: string,
    sourceIndices?: readonly number[],
  ): number[] {
    const descriptor = this.fieldDescriptors.get(fieldPath);
    if (!descriptor) return [];

    const { collectionKey, nestedKey } = descriptor;
    const matchedIndices: number[] = [];

    if (sourceIndices) {
      for (
        let candidateIndex = 0;
        candidateIndex < sourceIndices.length;
        candidateIndex++
      ) {
        const itemIndex = sourceIndices[candidateIndex];
        const item = data[itemIndex];
        const collection = item[collectionKey];
        if (!Array.isArray(collection)) continue;

        let hasMatch = false;

        for (
          let nestedIndex = 0;
          nestedIndex < collection.length;
          nestedIndex++
        ) {
          const rawValue = collection[nestedIndex][nestedKey];
          if (typeof rawValue !== "string") continue;
          if (!rawValue.toLowerCase().includes(lowerQuery)) continue;

          hasMatch = true;
          break;
        }

        if (hasMatch) {
          matchedIndices.push(itemIndex);
        }
      }

      return matchedIndices;
    }

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      const collection = item[collectionKey];
      if (!Array.isArray(collection)) continue;

      let hasMatch = false;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const rawValue = collection[nestedIndex][nestedKey];
        if (typeof rawValue !== "string") continue;
        if (!rawValue.toLowerCase().includes(lowerQuery)) continue;

        hasMatch = true;
        break;
      }

      if (hasMatch) {
        matchedIndices.push(itemIndex);
      }
    }

    return matchedIndices;
  }

  matchesAnyField(item: T, lowerQuery: string): boolean {
    for (const fieldPath of this.registeredFields) {
      const descriptor = this.fieldDescriptors.get(fieldPath);
      if (!descriptor) continue;

      const { collectionKey, nestedKey } = descriptor;
      const collection = item[collectionKey];
      if (!Array.isArray(collection)) continue;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const rawValue = collection[nestedIndex][nestedKey];
        if (typeof rawValue !== "string") continue;
        if (rawValue.toLowerCase().includes(lowerQuery)) return true;
      }
    }

    return false;
  }

  private registerField(fieldPath: string): void {
    const descriptor = this.createDescriptor(fieldPath);
    if (!descriptor) return;

    this.registeredFields.add(fieldPath);
    this.fieldDescriptors.set(fieldPath, descriptor);
  }

  private createDescriptor(fieldPath: string): NestedFieldDescriptor | null {
    const dotIndex = fieldPath.indexOf(".");
    if (dotIndex === -1) return null;

    return {
      collectionKey: fieldPath.substring(0, dotIndex),
      nestedKey: fieldPath.substring(dotIndex + 1),
    };
  }

  private getNormalizedValues(fieldPath: string): string[] {
    const existing = this.storage.normalizedFieldValues.get(fieldPath);
    if (existing) return existing;

    const created: string[] = [];
    this.storage.normalizedFieldValues.set(fieldPath, created);
    return created;
  }

  private buildIndex(data: T[], fieldPath: string): void {
    const descriptor = this.fieldDescriptors.get(fieldPath);
    if (!descriptor) return;

    const { collectionKey, nestedKey } = descriptor;
    const ngramMap = new Map<string, Set<number>>();
    const normalizedFieldValues = new Array<string>(data.length);

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const item = data[itemIndex];
      const collection = item[collectionKey];
      if (!Array.isArray(collection)) continue;

      const normalizedNestedValues: string[] = [];

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const rawValue = collection[nestedIndex][nestedKey];
        if (typeof rawValue !== "string") continue;

        normalizedNestedValues.push(rawValue.toLowerCase());
      }

      if (normalizedNestedValues.length === 0) continue;

      const joinedValue = normalizedNestedValues.join("\n");
      normalizedFieldValues[itemIndex] = joinedValue;
      indexLowerValue(ngramMap, joinedValue, itemIndex);
    }

    this.storage.ngramIndexes.set(fieldPath, ngramMap);
    this.storage.normalizedFieldValues.set(fieldPath, normalizedFieldValues);
  }

  private addItemsToField(
    fieldPath: string,
    items: T[],
    startIndex: number,
  ): void {
    const descriptor = this.fieldDescriptors.get(fieldPath);
    const ngramMap = this.storage.ngramIndexes.get(fieldPath);

    if (!descriptor || !ngramMap) {
      return;
    }

    const normalizedFieldValues = this.getNormalizedValues(fieldPath);
    const { collectionKey, nestedKey } = descriptor;

    for (let itemOffset = 0; itemOffset < items.length; itemOffset++) {
      const item = items[itemOffset];
      const collection = item[collectionKey];
      if (!Array.isArray(collection)) {
        continue;
      }

      const normalizedNestedValues: string[] = [];
      const datasetIndex = startIndex + itemOffset;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const rawValue = collection[nestedIndex][nestedKey];
        if (typeof rawValue !== "string") {
          continue;
        }

        normalizedNestedValues.push(rawValue.toLowerCase());
      }

      if (normalizedNestedValues.length === 0) {
        continue;
      }

      const joinedValue = normalizedNestedValues.join("\n");
      normalizedFieldValues[datasetIndex] = joinedValue;
      indexLowerValue(ngramMap, joinedValue, datasetIndex);
    }
  }

  private updateItemInField(
    fieldPath: string,
    item: T,
    previousItem: T,
    itemIndex: number,
  ): void {
    const ngramMap = this.storage.ngramIndexes.get(fieldPath);
    if (!ngramMap) return;

    const normalizedFieldValues = this.getNormalizedValues(fieldPath);

    const previousNormalizedValue = this.getNormalizedItemValue(
      fieldPath,
      previousItem,
    );

    if (previousNormalizedValue) {
      removeLowerValue(ngramMap, previousNormalizedValue, itemIndex);
    }

    const nextNormalizedValue = this.getNormalizedItemValue(fieldPath, item);

    if (!nextNormalizedValue) {
      delete normalizedFieldValues[itemIndex];
      return;
    }

    normalizedFieldValues[itemIndex] = nextNormalizedValue;
    indexLowerValue(ngramMap, nextNormalizedValue, itemIndex);
  }

  private removeItemFromField(
    fieldPath: string,
    item: T,
    itemIndex: number,
  ): void {
    const ngramMap = this.storage.ngramIndexes.get(fieldPath);
    if (!ngramMap) return;

    const normalizedFieldValues = this.getNormalizedValues(fieldPath);

    const normalizedValue =
      normalizedFieldValues[itemIndex] ??
      this.getNormalizedItemValue(fieldPath, item);

    if (normalizedValue) {
      removeLowerValue(ngramMap, normalizedValue, itemIndex);
    }

    delete normalizedFieldValues[itemIndex];
  }

  private moveItemForField(
    fieldPath: string,
    item: T,
    fromIndex: number,
    toIndex: number,
  ): void {
    const ngramMap = this.storage.ngramIndexes.get(fieldPath);
    if (!ngramMap) return;

    const normalizedFieldValues = this.getNormalizedValues(fieldPath);

    const normalizedValue =
      normalizedFieldValues[fromIndex] ??
      this.getNormalizedItemValue(fieldPath, item);

    if (!normalizedValue) {
      delete normalizedFieldValues[fromIndex];
      return;
    }

    removeLowerValue(ngramMap, normalizedValue, fromIndex);
    indexLowerValue(ngramMap, normalizedValue, toIndex);
    normalizedFieldValues[toIndex] = normalizedValue;
    delete normalizedFieldValues[fromIndex];
  }

  private getNormalizedItemValue(fieldPath: string, item: T): string | null {
    const descriptor = this.fieldDescriptors.get(fieldPath);
    if (!descriptor) {
      return null;
    }

    const { collectionKey, nestedKey } = descriptor;
    const collection = item[collectionKey];
    if (!Array.isArray(collection)) {
      return null;
    }

    const normalizedNestedValues: string[] = [];

    for (let nestedIndex = 0; nestedIndex < collection.length; nestedIndex++) {
      const rawValue = collection[nestedIndex][nestedKey];
      if (typeof rawValue !== "string") {
        continue;
      }

      normalizedNestedValues.push(rawValue.toLowerCase());
    }

    if (normalizedNestedValues.length === 0) {
      return null;
    }

    return normalizedNestedValues.join("\n");
  }
}
