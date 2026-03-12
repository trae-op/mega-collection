import { CollectionItem } from "../types";
import { indexLowerValue, removeLowerValue } from "./ngram";
import type { NestedFieldDescriptor } from "./types";

export class SearchNestedCollection<T extends CollectionItem> {
  private readonly registeredFields = new Set<string>();

  private readonly fieldDescriptors = new Map<string, NestedFieldDescriptor>();

  private readonly ngramIndexes = new Map<string, Map<string, Set<number>>>();

  private readonly normalizedFieldValues = new Map<string, string[]>();

  registerFields(fieldPaths?: readonly string[]): void {
    if (!fieldPaths?.length) return;

    for (let fieldIndex = 0; fieldIndex < fieldPaths.length; fieldIndex++) {
      this.registerField(fieldPaths[fieldIndex]);
    }
  }

  hasRegisteredFields(): boolean {
    return this.registeredFields.size > 0;
  }

  hasField(fieldPath: string): boolean {
    return this.registeredFields.has(fieldPath);
  }

  hasIndexes(): boolean {
    return this.ngramIndexes.size > 0;
  }

  clearIndexes(): void {
    this.ngramIndexes.clear();
    this.normalizedFieldValues.clear();
  }

  buildIndexes(data: T[]): void {
    this.clearIndexes();

    for (const fieldPath of this.registeredFields) {
      this.buildIndex(data, fieldPath);
    }
  }

  addItems(items: T[], startIndex: number): void {
    if (items.length === 0 || this.ngramIndexes.size === 0) {
      return;
    }

    for (const fieldPath of this.ngramIndexes.keys()) {
      this.addItemsToField(fieldPath, items, startIndex);
    }
  }

  updateItem(item: T, previousItem: T, itemIndex: number): void {
    if (this.ngramIndexes.size === 0) {
      return;
    }

    for (const fieldPath of this.ngramIndexes.keys()) {
      this.updateItemInField(fieldPath, item, previousItem, itemIndex);
    }
  }

  removeItem(item: T, itemIndex: number): void {
    if (this.ngramIndexes.size === 0) {
      return;
    }

    for (const fieldPath of this.ngramIndexes.keys()) {
      this.removeItemFromField(fieldPath, item, itemIndex);
    }
  }

  moveItem(item: T, fromIndex: number, toIndex: number): void {
    if (this.ngramIndexes.size === 0 || fromIndex === toIndex) {
      return;
    }

    for (const fieldPath of this.ngramIndexes.keys()) {
      this.moveItemForField(fieldPath, item, fromIndex, toIndex);
    }
  }

  searchAllIndexedFields(
    data: T[],
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
  ): T[] {
    const seenItems = new Set<T>();
    const matchedItems: T[] = [];

    for (const fieldPath of this.registeredFields) {
      for (const item of this.searchIndexedField(
        data,
        fieldPath,
        lowerQuery,
        uniqueQueryGrams,
      )) {
        if (seenItems.has(item)) continue;

        seenItems.add(item);
        matchedItems.push(item);
      }
    }

    return matchedItems;
  }

  searchIndexedField(
    data: T[],
    fieldPath: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
  ): T[] {
    const ngramMap = this.ngramIndexes.get(fieldPath);
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
    const normalizedValues = this.normalizedFieldValues.get(fieldPath);

    for (const candidateIndex of smallestPostingList) {
      let isCandidate = true;

      for (let listIndex = 1; listIndex < totalPostingLists; listIndex++) {
        if (postingLists[listIndex].has(candidateIndex)) continue;

        isCandidate = false;
        break;
      }

      if (!isCandidate) continue;

      const candidateItem = data[candidateIndex];
      if (!candidateItem) continue;

      const normalizedValue = normalizedValues?.[candidateIndex];
      if (!normalizedValue?.includes(lowerQuery)) continue;

      matchedItems.push(candidateItem);
    }

    return matchedItems;
  }

  searchFieldLinear(data: T[], fieldPath: string, lowerQuery: string): T[] {
    const descriptor = this.fieldDescriptors.get(fieldPath);
    if (!descriptor) return [];

    const { collectionKey, nestedKey } = descriptor;
    const matchedItems: T[] = [];

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
        matchedItems.push(item);
      }
    }

    return matchedItems;
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

        const lowerValue = rawValue.toLowerCase();
        normalizedNestedValues.push(lowerValue);
        indexLowerValue(ngramMap, lowerValue, itemIndex);
      }

      if (normalizedNestedValues.length === 0) continue;

      normalizedFieldValues[itemIndex] = normalizedNestedValues.join("\n");
    }

    this.ngramIndexes.set(fieldPath, ngramMap);
    this.normalizedFieldValues.set(fieldPath, normalizedFieldValues);
  }

  private addItemsToField(
    fieldPath: string,
    items: T[],
    startIndex: number,
  ): void {
    const descriptor = this.fieldDescriptors.get(fieldPath);
    const ngramMap = this.ngramIndexes.get(fieldPath);

    if (!descriptor || !ngramMap) {
      return;
    }

    const normalizedFieldValues =
      this.normalizedFieldValues.get(fieldPath) ?? [];
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

        const lowerValue = rawValue.toLowerCase();
        normalizedNestedValues.push(lowerValue);
        indexLowerValue(ngramMap, lowerValue, datasetIndex);
      }

      if (normalizedNestedValues.length === 0) {
        continue;
      }

      normalizedFieldValues[datasetIndex] = normalizedNestedValues.join("\n");
    }

    this.normalizedFieldValues.set(fieldPath, normalizedFieldValues);
  }

  private updateItemInField(
    fieldPath: string,
    item: T,
    previousItem: T,
    itemIndex: number,
  ): void {
    const ngramMap = this.ngramIndexes.get(fieldPath);
    const normalizedFieldValues =
      this.normalizedFieldValues.get(fieldPath) ?? [];

    if (!ngramMap) {
      return;
    }

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
      this.normalizedFieldValues.set(fieldPath, normalizedFieldValues);
      return;
    }

    normalizedFieldValues[itemIndex] = nextNormalizedValue;
    indexLowerValue(ngramMap, nextNormalizedValue, itemIndex);
    this.normalizedFieldValues.set(fieldPath, normalizedFieldValues);
  }

  private removeItemFromField(
    fieldPath: string,
    item: T,
    itemIndex: number,
  ): void {
    const ngramMap = this.ngramIndexes.get(fieldPath);
    const normalizedFieldValues =
      this.normalizedFieldValues.get(fieldPath) ?? [];

    if (!ngramMap) {
      return;
    }

    const normalizedValue = this.getNormalizedItemValue(fieldPath, item);

    if (normalizedValue) {
      removeLowerValue(ngramMap, normalizedValue, itemIndex);
    }

    delete normalizedFieldValues[itemIndex];
    this.normalizedFieldValues.set(fieldPath, normalizedFieldValues);
  }

  private moveItemForField(
    fieldPath: string,
    item: T,
    fromIndex: number,
    toIndex: number,
  ): void {
    const ngramMap = this.ngramIndexes.get(fieldPath);
    const normalizedFieldValues =
      this.normalizedFieldValues.get(fieldPath) ?? [];

    if (!ngramMap) {
      return;
    }

    const normalizedValue =
      normalizedFieldValues[fromIndex] ??
      this.getNormalizedItemValue(fieldPath, item);

    if (!normalizedValue) {
      delete normalizedFieldValues[fromIndex];
      this.normalizedFieldValues.set(fieldPath, normalizedFieldValues);
      return;
    }

    removeLowerValue(ngramMap, normalizedValue, fromIndex);
    indexLowerValue(ngramMap, normalizedValue, toIndex);
    normalizedFieldValues[toIndex] = normalizedValue;
    delete normalizedFieldValues[fromIndex];
    this.normalizedFieldValues.set(fieldPath, normalizedFieldValues);
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
