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
    const map = new Map<any, T[]>();

    for (let i = 0, len = data.length; i < len; i++) {
      const item = data[i];
      const key = item[field];
      if (key === undefined || key === null) continue;

      const bucket = map.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        map.set(key, [item]);
      }
    }

    this.indexes.set(field as string, map);
  }

  /** O(1) exact-value lookup. Returns matching items or empty array. */
  getByValue(field: keyof T & string, value: any): T[] {
    const map = this.indexes.get(field as string);
    if (!map) return [];
    return map.get(value) ?? [];
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
    const map = this.indexes.get(field as string);
    if (!map) return [];

    // Fast path: single value — no dedup needed
    if (values.length === 1) {
      return map.get(values[0]) ?? [];
    }

    // Multiple values: collect and deduplicate via Set
    const seen = new Set<T>();
    const results: T[] = [];

    for (let i = 0; i < values.length; i++) {
      const bucket = map.get(values[i]);
      if (bucket) {
        for (let j = 0; j < bucket.length; j++) {
          const item = bucket[j];
          if (!seen.has(item)) {
            seen.add(item);
            results.push(item);
          }
        }
      }
    }
    return results;
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
