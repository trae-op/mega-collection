import { CollectionItem, type FilterCriterion } from "../types";
import { resolveCriteria, type ResolvedFilterCriterion } from "./criterion";
import type { NestedFieldDescriptor } from "./types";

export class FilterNestedCollection<T extends CollectionItem> {
  private readonly registeredFields = new Set<string>();

  private readonly fieldDescriptors = new Map<string, NestedFieldDescriptor>();

  private indexes = new Map<string, Map<any, T[]>>();

  private itemPositions = new Map<string, Map<any, WeakMap<T, number>>>();

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

  clearIndexes(): void {
    this.indexes.clear();
    this.itemPositions.clear();
  }

  buildIndexes(data: T[]): void {
    this.indexes.clear();
    this.itemPositions.clear();

    for (const fieldPath of this.registeredFields) {
      this.buildIndex(data, fieldPath);
    }
  }

  removeItem(item: T): void {
    for (const fieldPath of this.indexes.keys()) {
      this.removeItemFromIndex(fieldPath, item);
    }
  }

  filter(
    sourceData: T[],
    criteria: FilterCriterion<T>[] | ResolvedFilterCriterion<T>[],
    dataset: T[],
  ): T[] {
    const resolvedCriteria = this.resolveCriteria(criteria);

    if (sourceData.length === 0 || resolvedCriteria.length === 0) {
      return sourceData;
    }

    const indexedCriteria: ResolvedFilterCriterion<T>[] = [];
    const linearCriteria: ResolvedFilterCriterion<T>[] = [];

    for (
      let criterionIndex = 0;
      criterionIndex < resolvedCriteria.length;
      criterionIndex++
    ) {
      const criterion = resolvedCriteria[criterionIndex];
      if (this.indexes.has(criterion.field)) {
        indexedCriteria.push(criterion);
        continue;
      }

      linearCriteria.push(criterion);
    }

    let result = sourceData;

    if (indexedCriteria.length > 0) {
      result = this.filterByIndexes(indexedCriteria, sourceData, dataset);
      if (result.length === 0) return result;
    }

    for (
      let criterionIndex = 0;
      criterionIndex < linearCriteria.length;
      criterionIndex++
    ) {
      result = this.filterLinearly(result, linearCriteria[criterionIndex]);
      if (result.length === 0) return result;
    }

    return result;
  }

  private resolveCriteria(
    criteria: FilterCriterion<T>[] | ResolvedFilterCriterion<T>[],
  ): ResolvedFilterCriterion<T>[] {
    if (criteria.length === 0) {
      return [];
    }

    const firstCriterion = criteria[0] as ResolvedFilterCriterion<T>;
    if (
      "hasValues" in firstCriterion &&
      "hasExclude" in firstCriterion &&
      "includedValues" in firstCriterion
    ) {
      return criteria as ResolvedFilterCriterion<T>[];
    }

    return resolveCriteria(criteria as FilterCriterion<T>[]);
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
    const indexMap = new Map<any, T[]>();
    const fieldItemPositions = new Map<any, WeakMap<T, number>>();

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const item = data[itemIndex];
      const collection = item[collectionKey];
      if (!Array.isArray(collection)) continue;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const value = collection[nestedIndex][nestedKey];
        if (value === undefined || value === null) continue;

        const bucket = indexMap.get(value);
        if (bucket) {
          if (bucket[bucket.length - 1] !== item) {
            bucket.push(item);
            fieldItemPositions.get(value)!.set(item, bucket.length - 1);
          }
          continue;
        }

        indexMap.set(value, [item]);

        const bucketItemPositions = new WeakMap<T, number>();
        bucketItemPositions.set(item, 0);
        fieldItemPositions.set(value, bucketItemPositions);
      }
    }

    this.indexes.set(fieldPath, indexMap);
    this.itemPositions.set(fieldPath, fieldItemPositions);
  }

  private removeItemFromIndex(fieldPath: string, item: T): void {
    const descriptor = this.fieldDescriptors.get(fieldPath);
    const indexMap = this.indexes.get(fieldPath);
    const fieldItemPositions = this.itemPositions.get(fieldPath);

    if (!descriptor || !indexMap || !fieldItemPositions) {
      return;
    }

    const { collectionKey, nestedKey } = descriptor;
    const collection = item[collectionKey];
    if (!Array.isArray(collection) || collection.length === 0) {
      return;
    }

    const nestedValues = new Set<any>();

    for (let nestedIndex = 0; nestedIndex < collection.length; nestedIndex++) {
      const nestedValue = collection[nestedIndex][nestedKey];
      if (nestedValue === undefined || nestedValue === null) {
        continue;
      }

      nestedValues.add(nestedValue);
    }

    for (const nestedValue of nestedValues) {
      const bucket = indexMap.get(nestedValue);
      const bucketItemPositionMap = fieldItemPositions.get(nestedValue);
      const itemIndex = bucketItemPositionMap?.get(item);

      if (!bucket || !bucketItemPositionMap || itemIndex === undefined) {
        continue;
      }

      const lastIndex = bucket.length - 1;
      const lastItem = bucket[lastIndex];

      if (itemIndex !== lastIndex) {
        bucket[itemIndex] = lastItem;
        bucketItemPositionMap.set(lastItem, itemIndex);
      }

      bucket.pop();
      bucketItemPositionMap.delete(item);

      if (bucket.length === 0) {
        indexMap.delete(nestedValue);
        fieldItemPositions.delete(nestedValue);
      }
    }
  }

  private filterByIndexes(
    criteria: ResolvedFilterCriterion<T>[],
    sourceData: T[],
    dataset: T[],
  ): T[] {
    const inclusionCriteria = criteria.filter(
      (criterion) => criterion.hasValues,
    );
    const exclusionCriteria = criteria.filter(
      (criterion) => criterion.hasExclude,
    );
    const allowedItems = sourceData === dataset ? null : new Set(sourceData);

    if (inclusionCriteria.length === 0) {
      return this.applyIndexedExclusions(sourceData, exclusionCriteria);
    }

    if (inclusionCriteria.length === 1) {
      const nestedIndex = this.indexes.get(inclusionCriteria[0].field);
      if (!nestedIndex) return [];

      const matchingItems = this.getItemsByValues(
        nestedIndex,
        inclusionCriteria[0].values,
      );
      if (matchingItems.length === 0) return [];

      const filteredItems: T[] = [];

      for (let itemIndex = 0; itemIndex < matchingItems.length; itemIndex++) {
        const item = matchingItems[itemIndex];
        if (allowedItems && !allowedItems.has(item)) {
          continue;
        }

        filteredItems.push(item);
      }

      return this.applyIndexedExclusions(filteredItems, exclusionCriteria);
    }

    const estimatedCriteria = inclusionCriteria
      .map((criterion) => ({
        criterion,
        size: this.estimateIndexSize(criterion),
      }))
      .sort(
        (leftEstimate, rightEstimate) => leftEstimate.size - rightEstimate.size,
      );

    let currentAllowedItems = allowedItems;
    let matchingItems: T[] = [];

    for (
      let criterionIndex = 0;
      criterionIndex < estimatedCriteria.length;
      criterionIndex++
    ) {
      const { criterion } = estimatedCriteria[criterionIndex];
      const nestedIndex = this.indexes.get(criterion.field);

      if (!nestedIndex) return [];

      const nextMatchingItems = this.getItemsByValues(
        nestedIndex,
        criterion.values,
      );
      if (nextMatchingItems.length === 0) return [];

      if (currentAllowedItems === null) {
        matchingItems = nextMatchingItems;
      } else {
        matchingItems = [];

        for (
          let itemIndex = 0;
          itemIndex < nextMatchingItems.length;
          itemIndex++
        ) {
          const item = nextMatchingItems[itemIndex];
          if (currentAllowedItems.has(item)) {
            matchingItems.push(item);
          }
        }
      }

      if (matchingItems.length === 0) return [];

      currentAllowedItems = new Set(matchingItems);
    }
    return this.applyIndexedExclusions(matchingItems, exclusionCriteria);
  }

  private getItemsByValues(indexMap: Map<any, T[]>, values: any[]): T[] {
    if (values.length === 1) {
      return indexMap.get(values[0]) ?? [];
    }

    const seenItems = new Set<T>();
    const result: T[] = [];

    for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
      const bucket = indexMap.get(values[valueIndex]);
      if (!bucket) continue;

      for (let itemIndex = 0; itemIndex < bucket.length; itemIndex++) {
        const item = bucket[itemIndex];
        if (seenItems.has(item)) continue;

        seenItems.add(item);
        result.push(item);
      }
    }

    return result;
  }

  private estimateIndexSize(criterion: ResolvedFilterCriterion<T>): number {
    const indexMap = this.indexes.get(criterion.field);
    if (!indexMap) return Infinity;

    return criterion.values.reduce((totalSize, value) => {
      const bucket = indexMap.get(value);
      return bucket ? totalSize + bucket.length : totalSize;
    }, 0);
  }

  private filterLinearly(
    data: T[],
    criterion: ResolvedFilterCriterion<T>,
  ): T[] {
    const descriptor = this.fieldDescriptors.get(criterion.field);
    if (!descriptor) return data;

    const { collectionKey, nestedKey } = descriptor;
    const result: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      const collection = item[collectionKey];
      if (!Array.isArray(collection)) continue;

      let hasIncludedMatch = !criterion.hasValues;
      let hasExcludedMatch = false;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const nestedValue = collection[nestedIndex][nestedKey];

        if (
          criterion.hasExclude &&
          criterion.excludedValues!.has(nestedValue)
        ) {
          hasExcludedMatch = true;
          break;
        }

        if (!criterion.hasValues) {
          continue;
        }

        if (criterion.includedValues!.has(nestedValue)) {
          hasIncludedMatch = true;
        }
      }

      if (!hasExcludedMatch && hasIncludedMatch) {
        result.push(item);
      }
    }

    return result;
  }

  private applyIndexedExclusions(
    data: T[],
    criteria: ResolvedFilterCriterion<T>[],
  ): T[] {
    if (criteria.length === 0 || data.length === 0) {
      return data;
    }

    const excludedItems = new Set<T>();

    for (
      let criterionIndex = 0;
      criterionIndex < criteria.length;
      criterionIndex++
    ) {
      const criterion = criteria[criterionIndex];
      const indexMap = this.indexes.get(criterion.field);
      if (!indexMap) {
        continue;
      }

      const matchingItems = this.getItemsByValues(indexMap, criterion.exclude);
      for (let itemIndex = 0; itemIndex < matchingItems.length; itemIndex++) {
        excludedItems.add(matchingItems[itemIndex]);
      }
    }

    if (excludedItems.size === 0) {
      return data;
    }

    const result: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      if (!excludedItems.has(item)) {
        result.push(item);
      }
    }

    return result;
  }
}
