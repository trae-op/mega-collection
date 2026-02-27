/**
 * Indexer class that builds hash-map indexes for exact-value lookups
 * on collection fields, enabling O(1) queries.
 */

import { CollectionItem } from "./types";

export class Indexer<T extends CollectionItem> {
  private indexes = new Map<string, Map<any, T[]>>();

  /**
   * Builds an index for the given field and data.
   */
  buildIndex(data: T[], field: keyof T & string): void {
    const indexMap = new Map<any, T[]>();

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
      } else {
        indexMap.set(fieldValue, [item]);
      }
    }

    this.indexes.set(field as string, indexMap);
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

  clear(): void {
    this.indexes.clear();
  }

  getIndexMap(field: string): Map<any, T[]> | undefined {
    return this.indexes.get(field);
  }
}
