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

import { CollectionItem, FilterCriterion } from "../types";
import { Indexer } from "../indexer";

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

    // --- Mixed path: use indexes to narrow candidates, then linear scan ---
    // This avoids O(n) full-dataset scans when indexes can pre-filter.
    if (indexedCriteria.length > 0 && linearCriteria.length > 0) {
      const candidates = this.filterViaIndex(indexedCriteria);
      return this.linearFilter(candidates, linearCriteria);
    }

    // --- Pure linear path (no indexes available) ---
    return this.linearFilter(data, criteria);
  }

  /**
   * Linear scan with Set-based membership tests. O(n * k) where
   * n = data.length and k = number of criteria (each test is O(1) via Set).
   */
  private linearFilter(data: T[], criteria: FilterCriterion<T>[]): T[] {
    const valueSets = criteria.map((c) => ({
      field: c.field,
      set: new Set(c.values),
    }));

    const results: T[] = [];
    const numCriteria = valueSets.length;

    for (let i = 0, len = data.length; i < len; i++) {
      const item = data[i];
      let pass = true;

      for (let c = 0; c < numCriteria; c++) {
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
   * approach. Criteria are sorted by estimated selectivity (smallest
   * candidate set first) to prune the intersection early.
   */
  private filterViaIndex(criteria: FilterCriterion<T>[]): T[] {
    // For a single criterion, just grab from the index
    if (criteria.length === 1) {
      return this.indexer.getByValues(criteria[0].field, criteria[0].values);
    }

    // Estimate candidate-set sizes and sort smallest first for faster pruning.
    const estimated = criteria.map((c) => ({
      criterion: c,
      size: this.estimateIndexSize(c),
    }));
    estimated.sort((a, b) => a.size - b.size);

    // Start from the smallest candidate set
    const first = estimated[0].criterion;
    const candidateItems = this.indexer.getByValues(first.field, first.values);

    if (candidateItems.length === 0) return [];

    // Use a Set for the running intersection
    let candidateSet = new Set<T>(candidateItems);

    for (let i = 1; i < estimated.length; i++) {
      const c = estimated[i].criterion;
      const nextItems = this.indexer.getByValues(c.field, c.values);
      const nextSet = new Set<T>(nextItems);

      // Intersect: keep only items present in both
      const intersection = new Set<T>();
      for (const item of candidateSet) {
        if (nextSet.has(item)) {
          intersection.add(item);
        }
      }
      candidateSet = intersection;

      if (candidateSet.size === 0) return [];
    }

    return Array.from(candidateSet);
  }

  /**
   * Estimate the number of items an indexed criterion would return.
   * Used to sort criteria by selectivity for faster intersection.
   */
  private estimateIndexSize(criterion: FilterCriterion<T>): number {
    const map = this.indexer.getIndexMap(criterion.field);
    if (!map) return Infinity;

    let size = 0;
    for (const val of criterion.values) {
      const bucket = map.get(val);
      if (bucket) size += bucket.length;
    }
    return size;
  }
}
