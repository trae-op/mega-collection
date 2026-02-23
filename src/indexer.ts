/**
 * Indexer — builds and queries hash-map indexes for O(1) exact-key lookups.
 *
 * Strategy:
 *  For every indexed field we maintain a `Map<string | number, T[]>`.
 *  Building the index is O(n) and lookup is O(1) amortised.
 *  This is the fastest possible approach for exact-match queries on 10 M+ rows.
 */

import { CollectionItem } from "./types";

export class Indexer<T extends CollectionItem> {
  /** field → (value → items[]) */
  private indexes = new Map<string, Map<any, T[]>>();

  /** Build an index for the given field across the entire dataset. O(n). */
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

  /** O(1) exact-value lookup. Returns matching items or empty array. */
  getByValue(field: keyof T & string, value: any): T[] {
    const indexMap = this.indexes.get(field as string);
    if (!indexMap) return [];
    return indexMap.get(value) ?? [];
  }

  /**
   * Multi-value lookup: return items that match ANY of the provided values
   * for the given field.  Equivalent to SQL `field IN (v1, v2, …)`.
   * Each value lookup is O(1), total O(k) where k = values.length.
   *
   * When only one value is provided, skips Set dedup for speed.
   * For multiple values, uses a Set to prevent duplicate items
   * (e.g. if the same item appears in multiple buckets).
   */
  getByValues(field: keyof T & string, values: any[]): T[] {
    const indexMap = this.indexes.get(field as string);
    if (!indexMap) return [];

    // Fast path: single value — no dedup needed
    if (values.length === 1) {
      return indexMap.get(values[0]) ?? [];
    }

    // Collect matching buckets, flatten, and deduplicate in a single pass
    const allMatchingItems = values
      .map((value) => indexMap.get(value))
      .filter((bucket): bucket is T[] => bucket !== undefined)
      .flat();

    const seenItems = new Set<T>();
    return allMatchingItems.filter((item) => {
      if (seenItems.has(item)) return false;
      seenItems.add(item);
      return true;
    });
  }

  /** Check whether an index exists for a field. */
  hasIndex(field: string): boolean {
    return this.indexes.has(field);
  }

  /** Remove all indexes (free memory). */
  clear(): void {
    this.indexes.clear();
  }

  /** Get the underlying map for a field (advanced usage). */
  getIndexMap(field: string): Map<any, T[]> | undefined {
    return this.indexes.get(field);
  }
}
