/**
 * FilterEngine — multi-criteria filtering optimised for 10 M+ rows.
 *
 * Strategy:
 *  1. If hash-map indexes exist (from Indexer), use O(1) lookups per value
 *     and intersect results across fields.  This is the *fast path*.
 *
 *  2. If no index is available for a field, fall back to a single-pass linear
 *     scan using a `Set` for each criterion (O(n) but with O(1) membership
 *     test per item).
 *
 *  Multiple criteria are combined with AND logic: an item must satisfy
 *  ALL criteria to be included.
 */

import { CollectionItem, FilterCriterion } from "./types";
import { Indexer } from "./indexer";

export class FilterEngine<T extends CollectionItem> {
  private indexer: Indexer<T>;

  constructor(indexer: Indexer<T>) {
    this.indexer = indexer;
  }

  /**
   * Apply multiple filter criteria (AND logic).
   *
   * @param data    - The full dataset.
   * @param criteria - Array of {field, values} objects. An item passes a
   *                   criterion if `item[field]` is in `criterion.values`.
   * @returns Filtered array.
   */
  filter(data: T[], criteria: FilterCriterion<T>[]): T[] {
    if (criteria.length === 0) return data;

    // --- Separate indexed vs. non-indexed criteria ---
    const indexedCriteria: FilterCriterion<T>[] = [];
    const linearCriteria: FilterCriterion<T>[] = [];

    for (const c of criteria) {
      if (this.indexer.hasIndex(c.field)) {
        indexedCriteria.push(c);
      } else {
        linearCriteria.push(c);
      }
    }

    // --- Fast path: all criteria are indexed ---
    if (indexedCriteria.length > 0 && linearCriteria.length === 0) {
      return this.filterViaIndex(indexedCriteria);
    }

    // --- Mixed / linear path ---
    // Pre-build Sets for O(1) value membership tests
    const valueSets = criteria.map((c) => ({
      field: c.field,
      set: new Set(c.values),
    }));

    const results: T[] = [];

    for (let i = 0, len = data.length; i < len; i++) {
      const item = data[i];
      let pass = true;

      for (let c = 0; c < valueSets.length; c++) {
        if (!valueSets[c].set.has(item[valueSets[c].field])) {
          pass = false;
          break;
        }
      }

      if (pass) results.push(item);
    }

    return results;
  }

  /**
   * Pure index-based filtering. For each criterion we pull items from the
   * hash-map, then intersect across criteria using a reference-counting
   * approach.
   */
  private filterViaIndex(criteria: FilterCriterion<T>[]): T[] {
    // For a single criterion, just grab from the index
    if (criteria.length === 1) {
      return this.indexer.getByValues(criteria[0].field, criteria[0].values);
    }

    // Multiple criteria: get candidate sets and intersect.
    // We use a WeakMap<T, count> — item passes if count === criteria.length.
    const hitCount = new Map<T, number>();
    const total = criteria.length;

    for (const c of criteria) {
      const items = this.indexer.getByValues(c.field, c.values);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        hitCount.set(item, (hitCount.get(item) ?? 0) + 1);
      }
    }

    const results: T[] = [];
    hitCount.forEach((count, item) => {
      if (count === total) results.push(item);
    });

    return results;
  }
}
