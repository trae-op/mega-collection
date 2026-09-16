import { CollectionItem, type FilterCriterion } from "../types";
import { normalizeArrayFieldValue } from "../internal";
import { resolveCriteria } from "./criterion";
import type { ResolvedFilterCriterion } from "./types";

export interface FilterArrayCollectionStorage<T extends CollectionItem> {
  indexes: Map<string, Map<any, T[]>>;
  itemPositions: Map<string, Map<any, WeakMap<T, number>>>;
}

export class FilterArrayCollection<T extends CollectionItem> {
  private readonly registeredFields = new Set<string>();

  constructor(
    private readonly storage: FilterArrayCollectionStorage<T> = {
      indexes: new Map<string, Map<any, T[]>>(),
      itemPositions: new Map<string, Map<any, WeakMap<T, number>>>(),
    },
  ) {}

  registerFields(fields?: readonly string[]): void {
    if (!fields?.length) return;

    for (let i = 0; i < fields.length; i++) {
      this.registeredFields.add(fields[i]);
    }
  }

  hasRegisteredFields(): boolean {
    return this.registeredFields.size > 0;
  }

  hasField(field: string): boolean {
    return this.registeredFields.has(field);
  }

  clearIndexes(): void {
    this.storage.indexes.clear();
    this.storage.itemPositions.clear();
  }

  buildIndexes(data: T[]): void {
    this.storage.indexes.clear();
    this.storage.itemPositions.clear();

    for (const field of this.registeredFields) {
      this.buildIndex(data, field);
    }
  }

  addItems(items: T[]): void {
    if (items.length === 0 || this.storage.indexes.size === 0) {
      return;
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      this.addItem(items[itemIndex]);
    }
  }

  removeItem(item: T): void {
    for (const field of this.storage.indexes.keys()) {
      this.removeItemFromIndex(field, item);
    }
  }

  updateItem(nextItem: T, previousItem: T): void {
    for (const field of this.storage.indexes.keys()) {
      this.updateItemInIndex(field, nextItem, previousItem);
    }
  }

  filter(sourceData: T[], criteria: FilterCriterion<T>[], dataset: T[]): T[] {
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
      if (this.storage.indexes.has(criterion.field)) {
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

  private buildIndex(data: T[], field: string): void {
    const indexMap = new Map<any, T[]>();
    const fieldItemPositions = new Map<any, WeakMap<T, number>>();

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const item = data[itemIndex];
      const arr = item[field];
      if (!Array.isArray(arr)) continue;

      const seenValues = new Set<any>();

      for (let i = 0; i < arr.length; i++) {
        const rawValue = arr[i];
        if (normalizeArrayFieldValue(rawValue) === null) continue;
        if (seenValues.has(rawValue)) continue;
        seenValues.add(rawValue);

        const bucket = indexMap.get(rawValue);
        if (bucket) {
          if (bucket[bucket.length - 1] !== item) {
            bucket.push(item);
            fieldItemPositions.get(rawValue)!.set(item, bucket.length - 1);
          }
          continue;
        }

        indexMap.set(rawValue, [item]);

        const bucketItemPositions = new WeakMap<T, number>();
        bucketItemPositions.set(item, 0);
        fieldItemPositions.set(rawValue, bucketItemPositions);
      }
    }

    this.storage.indexes.set(field, indexMap);
    this.storage.itemPositions.set(field, fieldItemPositions);
  }

  private removeItemFromIndex(field: string, item: T): void {
    const indexMap = this.storage.indexes.get(field);
    const fieldItemPositions = this.storage.itemPositions.get(field);

    if (!indexMap || !fieldItemPositions) {
      return;
    }

    const arr = item[field];
    if (!Array.isArray(arr) || arr.length === 0) {
      return;
    }

    const uniqueValues = new Set<any>();

    for (let i = 0; i < arr.length; i++) {
      const rawValue = arr[i];
      if (normalizeArrayFieldValue(rawValue) === null) continue;
      uniqueValues.add(rawValue);
    }

    for (const rawValue of uniqueValues) {
      const bucket = indexMap.get(rawValue);
      const bucketItemPositionMap = fieldItemPositions.get(rawValue);
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
        indexMap.delete(rawValue);
        fieldItemPositions.delete(rawValue);
      }
    }
  }

  private addItem(item: T): void {
    for (const field of this.storage.indexes.keys()) {
      this.addItemToIndex(field, item);
    }
  }

  private addItemToIndex(field: string, item: T): void {
    const indexMap = this.storage.indexes.get(field);
    const fieldItemPositions = this.storage.itemPositions.get(field);

    if (!indexMap || !fieldItemPositions) {
      return;
    }

    const arr = item[field];
    if (!Array.isArray(arr) || arr.length === 0) {
      return;
    }

    const uniqueValues = new Set<any>();

    for (let i = 0; i < arr.length; i++) {
      const rawValue = arr[i];
      if (normalizeArrayFieldValue(rawValue) === null) continue;
      uniqueValues.add(rawValue);
    }

    for (const rawValue of uniqueValues) {
      const bucket = indexMap.get(rawValue);
      const bucketItemPositions = fieldItemPositions.get(rawValue);

      if (bucket && bucketItemPositions) {
        bucket.push(item);
        bucketItemPositions.set(item, bucket.length - 1);
        continue;
      }

      indexMap.set(rawValue, [item]);

      const nextBucketItemPositions = new WeakMap<T, number>();
      nextBucketItemPositions.set(item, 0);
      fieldItemPositions.set(rawValue, nextBucketItemPositions);
    }
  }

  private updateItemInIndex(field: string, nextItem: T, previousItem: T): void {
    const indexMap = this.storage.indexes.get(field);
    const fieldItemPositions = this.storage.itemPositions.get(field);

    if (!indexMap || !fieldItemPositions) {
      return;
    }

    const previousValues = this.collectUniqueValues(previousItem, field);
    const nextValues = this.collectUniqueValues(nextItem, field);

    if (this.areValueSetsEqual(previousValues, nextValues)) {
      for (const value of previousValues) {
        const bucket = indexMap.get(value);
        const bucketItemPositions = fieldItemPositions.get(value);
        const itemIndex = bucketItemPositions?.get(previousItem);

        if (!bucket || !bucketItemPositions || itemIndex === undefined) {
          continue;
        }

        bucket[itemIndex] = nextItem;
        bucketItemPositions.delete(previousItem);
        bucketItemPositions.set(nextItem, itemIndex);
      }

      return;
    }

    this.removeItemFromIndex(field, previousItem);
    this.addItemToIndex(field, nextItem);
  }

  private collectUniqueValues(item: T, field: string): Set<any> {
    const arr = item[field];
    const values = new Set<any>();

    if (!Array.isArray(arr) || arr.length === 0) {
      return values;
    }

    for (let i = 0; i < arr.length; i++) {
      const rawValue = arr[i];
      if (normalizeArrayFieldValue(rawValue) === null) continue;
      values.add(rawValue);
    }

    return values;
  }

  private areValueSetsEqual(left: Set<any>, right: Set<any>): boolean {
    if (left.size !== right.size) {
      return false;
    }

    for (const value of left) {
      if (!right.has(value)) {
        return false;
      }
    }

    return true;
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

    // For array fields: AND semantics — item must contain ALL selected values.
    // Start with the smallest bucket, then intersect with all other buckets.
    let matchingItems: T[] = [];

    for (
      let criterionIndex = 0;
      criterionIndex < inclusionCriteria.length;
      criterionIndex++
    ) {
      const criterion = inclusionCriteria[criterionIndex];
      const indexMap = this.storage.indexes.get(criterion.field);
      if (!indexMap) return [];

      // Deduplicate criterion values
      const uniqueValues = new Set(criterion.values);
      if (uniqueValues.size === 0) return [];

      const buckets: T[][] = [];
      for (const value of uniqueValues) {
        const bucket = indexMap.get(value);
        if (!bucket || bucket.length === 0) return [];
        buckets.push(bucket);
      }

      // Find smallest bucket
      let smallestBucket = buckets[0];
      for (let i = 1; i < buckets.length; i++) {
        if (buckets[i].length < smallestBucket.length) {
          smallestBucket = buckets[i];
        }
      }

      // Intersect: every selected value must be present
      const candidateItems: T[] = [];
      for (let i = 0; i < smallestBucket.length; i++) {
        const item = smallestBucket[i];
        if (allowedItems && !allowedItems.has(item)) continue;

        let hasAll = true;
        for (let b = 0; b < buckets.length; b++) {
          if (buckets[b] === smallestBucket) continue;
          if (!buckets[b].includes(item)) {
            hasAll = false;
            break;
          }
        }

        if (hasAll) candidateItems.push(item);
      }

      if (criterionIndex === 0) {
        matchingItems = candidateItems;
      } else {
        // Intersect across multiple array field criteria
        const allowedSet = new Set(matchingItems);
        matchingItems = candidateItems.filter((item) => allowedSet.has(item));
      }

      if (matchingItems.length === 0) return [];
    }

    return this.applyIndexedExclusions(matchingItems, exclusionCriteria);
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
      const indexMap = this.storage.indexes.get(criterion.field);
      if (!indexMap) {
        continue;
      }

      // For array fields: exclude items where array contains ANY excluded value
      for (
        let valueIndex = 0;
        valueIndex < criterion.exclude.length;
        valueIndex++
      ) {
        const bucket = indexMap.get(criterion.exclude[valueIndex]);
        if (!bucket) continue;

        for (let itemIndex = 0; itemIndex < bucket.length; itemIndex++) {
          excludedItems.add(bucket[itemIndex]);
        }
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

  private filterLinearly(
    data: T[],
    criterion: ResolvedFilterCriterion<T>,
  ): T[] {
    const field = criterion.field as string;
    const result: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      const arr = item[field];
      if (!Array.isArray(arr)) continue;

      // AND semantics for inclusion: all selected values must be present
      if (criterion.hasValues) {
        if (criterion.values.length === 0) continue;

        let hasAll = true;
        for (let v = 0; v < criterion.values.length; v++) {
          const selectedValue = criterion.values[v];
          let found = false;
          for (let a = 0; a < arr.length; a++) {
            if (arr[a] === selectedValue) {
              found = true;
              break;
            }
          }
          if (!found) {
            hasAll = false;
            break;
          }
        }
        if (!hasAll) continue;
      }

      // ANY semantics for exclusion: if any excluded value is present, exclude
      if (criterion.hasExclude) {
        let hasExcluded = false;
        for (let a = 0; a < arr.length; a++) {
          if (criterion.excludedValues!.has(arr[a])) {
            hasExcluded = true;
            break;
          }
        }
        if (hasExcluded) continue;
      }

      result.push(item);
    }

    return result;
  }
}
