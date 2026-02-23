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
    const { indexedCriteria, linearCriteria } = criteria.reduce(
      (
        accumulator: {
          indexedCriteria: FilterCriterion<T>[];
          linearCriteria: FilterCriterion<T>[];
        },
        criterion,
      ) => {
        if (this.indexer.hasIndex(criterion.field)) {
          accumulator.indexedCriteria.push(criterion);
        } else {
          accumulator.linearCriteria.push(criterion);
        }
        return accumulator;
      },
      { indexedCriteria: [], linearCriteria: [] },
    );

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
   * Single-pass linear filter using pre-indexed criteria value Sets.
   * O(n × k) where n = data.length, k = criteria count.
   * Each criterion check is O(1) via Map + Set lookup — no nested data iteration.
   */
  private linearFilter(data: T[], criteria: FilterCriterion<T>[]): T[] {
    // Pre-index: field → Set<acceptable values> (Rule 1: Index Before Iterate)
    const acceptableValuesByField = new Map<string, Set<any>>(
      criteria.map(({ field, values }) => [field, new Set(values)]),
    );
    const criterionFields = criteria.map(({ field }) => field);

    // Single-pass filter: each criterion is an O(1) Set lookup, not a nested scan
    return data.filter((item) =>
      criterionFields.every((field) =>
        acceptableValuesByField.get(field)!.has(item[field]),
      ),
    );
  }

  /**
   * Pure index-based filtering with selectivity-driven pruning.
   *
   * Strategy:
   *  1. Sort criteria by estimated result-set size (smallest first).
   *  2. Materialise only the most selective criterion via the index.
   *  3. Pre-index remaining criteria values into Sets for O(1) checks.
   *  4. Single-pass filter over candidates — no nested collection iteration.
   */
  private filterViaIndex(criteria: FilterCriterion<T>[]): T[] {
    // For a single criterion, just grab from the index
    if (criteria.length === 1) {
      return this.indexer.getByValues(criteria[0].field, criteria[0].values);
    }

    // Estimate candidate-set sizes and sort smallest first for faster pruning
    const estimatedCriteria = criteria
      .map((criterion) => ({
        criterion,
        size: this.estimateIndexSize(criterion),
      }))
      .sort(
        (leftEstimate, rightEstimate) => leftEstimate.size - rightEstimate.size,
      );

    // Materialise only the most selective criterion via the index
    const { field: mostSelectiveField, values: mostSelectiveValues } =
      estimatedCriteria[0].criterion;
    const candidateItems = this.indexer.getByValues(
      mostSelectiveField,
      mostSelectiveValues,
    );

    if (candidateItems.length === 0) return [];

    // Pre-index remaining criteria values for O(1) membership checks
    const remainingValuesByField = new Map<string, Set<any>>(
      estimatedCriteria
        .slice(1)
        .map(({ criterion: { field, values } }) => [field, new Set(values)]),
    );
    const remainingFields = Array.from(remainingValuesByField.keys());

    // Single-pass filter over candidates: O(1) Set check per criterion
    return candidateItems.filter((item) =>
      remainingFields.every((field) =>
        remainingValuesByField.get(field)!.has(item[field]),
      ),
    );
  }

  /**
   * Estimate the number of items an indexed criterion would return.
   * Used to sort criteria by selectivity for faster intersection.
   */
  private estimateIndexSize(criterion: FilterCriterion<T>): number {
    const indexMap = this.indexer.getIndexMap(criterion.field);
    if (!indexMap) return Infinity;

    return criterion.values.reduce((totalSize, value) => {
      const bucket = indexMap.get(value);
      return bucket ? totalSize + bucket.length : totalSize;
    }, 0);
  }
}
