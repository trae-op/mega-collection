/**
 * Indexer class that builds hash-map indexes for exact-value lookups
 * on collection fields, enabling O(1) queries.
 */

import { CollectionItem } from "./types";

export class Indexer<T extends CollectionItem> {
  private indexes = new Map<string, Map<any, T[]>>();

  private itemPositions = new Map<string, Map<any, WeakMap<T, number>>>();

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

    this.indexes.set(field as string, indexMap);
    this.itemPositions.set(field as string, fieldItemPositions);
  }

  /**
   * Gets items that match the given value for the field.
   */
  getByValue(field: keyof T & string, value: any): T[] {
    const indexMap = this.indexes.get(field as string);
    if (!indexMap) return [];
    return indexMap.get(value) ?? [];
  }

  /**
   * Gets items that match any of the given values for the field.
   */
  getByValues(field: keyof T & string, values: any[]): T[] {
    const indexMap = this.indexes.get(field as string);
    if (!indexMap) return [];

    if (values.length === 1) {
      return indexMap.get(values[0]) ?? [];
    }

    const seenItems = new Set<T>();
    const result: T[] = [];

    for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
      const bucket = indexMap.get(values[valueIndex]);
      if (bucket === undefined) continue;

      for (let bucketIndex = 0; bucketIndex < bucket.length; bucketIndex++) {
        const item = bucket[bucketIndex];
        if (!seenItems.has(item)) {
          seenItems.add(item);
          result.push(item);
        }
      }
    }

    return result;
  }

  hasIndex(field: string): boolean {
    return this.indexes.has(field);
  }

  removeItem(item: T): void {
    for (const field of this.indexes.keys()) {
      this.removeItemFromField(field as keyof T & string, item);
    }
  }

  clear(): void {
    this.indexes.clear();
    this.itemPositions.clear();
  }

  getIndexMap(field: string): Map<any, T[]> | undefined {
    return this.indexes.get(field);
  }

  private removeItemFromField(field: keyof T & string, item: T): void {
    const fieldValue = item[field];
    if (fieldValue === undefined || fieldValue === null) {
      return;
    }

    const indexMap = this.indexes.get(field as string);
    const fieldItemPositions = this.itemPositions.get(field as string);
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
}
