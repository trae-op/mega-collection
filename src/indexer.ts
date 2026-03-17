/**
 * Indexer class that builds hash-map indexes for exact-value lookups
 * on collection fields, enabling O(1) queries.
 */

import { CollectionItem } from "./types";

export interface IndexerStorage<T extends CollectionItem> {
  indexes: Map<string, Map<any, T[]>>;
  itemPositions: Map<string, Map<any, WeakMap<T, number>>>;
}

export class Indexer<T extends CollectionItem> {
  constructor(
    private readonly storage: IndexerStorage<T> = {
      indexes: new Map<string, Map<any, T[]>>(),
      itemPositions: new Map<string, Map<any, WeakMap<T, number>>>(),
    },
  ) {}

  addItems(items: T[]): void {
    if (items.length === 0 || this.storage.indexes.size === 0) {
      return;
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      this.addItem(items[itemIndex]);
    }
  }

  /**
   * Builds an index for the given field and data.
   */
  buildIndex(data: T[], field: keyof T & string): void {
    const indexMap = new Map<any, T[]>();
    const fieldItemPositions = new Map<any, WeakMap<T, number>>();

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const item = data[itemIndex];
      const fieldValue = item[field];
      if (fieldValue === undefined || fieldValue === null) continue;

      const bucket = indexMap.get(fieldValue);
      if (bucket) {
        bucket.push(item);
        fieldItemPositions.get(fieldValue)!.set(item, bucket.length - 1);
      } else {
        indexMap.set(fieldValue, [item]);

        const bucketItemPositions = new WeakMap<T, number>();
        bucketItemPositions.set(item, 0);
        fieldItemPositions.set(fieldValue, bucketItemPositions);
      }
    }

    this.storage.indexes.set(field as string, indexMap);
    this.storage.itemPositions.set(field as string, fieldItemPositions);
  }

  /**
   * Gets items that match the given value for the field.
   */
  getByValue(field: keyof T & string, value: any): T[] {
    const indexMap = this.storage.indexes.get(field as string);
    if (!indexMap) return [];
    return indexMap.get(value) ?? [];
  }

  /**
   * Gets items that match any of the given values for the field.
   *
   * Note: buildIndex indexes scalar field values, so buckets are always
   * disjoint — deduplication via Set is not needed. If multi-value field
   * indexing is ever added, re-introduce dedup here.
   */
  getByValues(field: keyof T & string, values: any[]): T[] {
    const indexMap = this.storage.indexes.get(field as string);
    if (!indexMap) return [];

    if (values.length === 1) {
      return indexMap.get(values[0]) ?? [];
    }

    // Fast path for the most common 2-value case — avoid array allocation.
    if (values.length === 2) {
      const b0 = indexMap.get(values[0]);
      const b1 = indexMap.get(values[1]);
      if (!b0) return b1 ?? [];
      if (!b1) return b0;
      return b0.concat(b1);
    }

    const result: T[] = [];

    for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
      const bucket = indexMap.get(values[valueIndex]);
      if (bucket === undefined) continue;

      for (let bucketIndex = 0; bucketIndex < bucket.length; bucketIndex++) {
        result.push(bucket[bucketIndex]);
      }
    }

    return result;
  }

  hasIndex(field: string): boolean {
    return this.storage.indexes.has(field);
  }

  addItem(item: T): void {
    for (const field of this.storage.indexes.keys()) {
      this.addItemToField(field as keyof T & string, item);
    }
  }

  updateItem(previousItem: T, nextItem: T): void {
    for (const field of this.storage.indexes.keys()) {
      this.updateItemInField(field as keyof T & string, previousItem, nextItem);
    }
  }

  removeItem(item: T): void {
    for (const field of this.storage.indexes.keys()) {
      this.removeItemFromField(field as keyof T & string, item);
    }
  }

  clear(): void {
    this.storage.indexes.clear();
    this.storage.itemPositions.clear();
  }

  getIndexMap(field: string): Map<any, T[]> | undefined {
    return this.storage.indexes.get(field);
  }

  private removeItemFromField(field: keyof T & string, item: T): void {
    const fieldValue = item[field];
    if (fieldValue === undefined || fieldValue === null) {
      return;
    }

    const indexMap = this.storage.indexes.get(field as string);
    const fieldItemPositions = this.storage.itemPositions.get(field as string);
    const bucket = indexMap?.get(fieldValue);
    const bucketItemPositionMap = fieldItemPositions?.get(fieldValue);
    const itemIndex = bucketItemPositionMap?.get(item);

    if (
      !indexMap ||
      !fieldItemPositions ||
      !bucket ||
      !bucketItemPositionMap ||
      itemIndex === undefined
    ) {
      return;
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
      indexMap.delete(fieldValue);
      fieldItemPositions.delete(fieldValue);
    }
  }

  private updateItemInField(
    field: keyof T & string,
    previousItem: T,
    nextItem: T,
  ): void {
    const previousFieldValue = previousItem[field];
    const nextFieldValue = nextItem[field];

    if (previousFieldValue === nextFieldValue) {
      if (previousFieldValue === undefined || previousFieldValue === null) {
        return;
      }

      this.replaceItemReferenceInField(
        field,
        previousFieldValue,
        previousItem,
        nextItem,
      );
      return;
    }

    this.removeItemFromField(field, previousItem);
    this.addItemToField(field, nextItem);
  }

  private replaceItemReferenceInField(
    field: keyof T & string,
    fieldValue: T[keyof T & string],
    previousItem: T,
    nextItem: T,
  ): void {
    const indexMap = this.storage.indexes.get(field as string);
    const fieldItemPositions = this.storage.itemPositions.get(field as string);
    const bucket = indexMap?.get(fieldValue);
    const bucketItemPositions = fieldItemPositions?.get(fieldValue);
    const itemIndex = bucketItemPositions?.get(previousItem);

    if (!bucket || !bucketItemPositions || itemIndex === undefined) {
      return;
    }

    bucket[itemIndex] = nextItem;
    bucketItemPositions.delete(previousItem);
    bucketItemPositions.set(nextItem, itemIndex);
  }

  private addItemToField(field: keyof T & string, item: T): void {
    const fieldValue = item[field];
    if (fieldValue === undefined || fieldValue === null) {
      return;
    }

    const indexMap = this.storage.indexes.get(field as string);
    const fieldItemPositions = this.storage.itemPositions.get(field as string);

    if (!indexMap || !fieldItemPositions) {
      return;
    }

    const bucket = indexMap.get(fieldValue);
    const bucketItemPositions = fieldItemPositions.get(fieldValue);

    if (bucket && bucketItemPositions) {
      bucket.push(item);
      bucketItemPositions.set(item, bucket.length - 1);
      return;
    }

    indexMap.set(fieldValue, [item]);

    const nextBucketItemPositions = new WeakMap<T, number>();
    nextBucketItemPositions.set(item, 0);
    fieldItemPositions.set(fieldValue, nextBucketItemPositions);
  }
}
