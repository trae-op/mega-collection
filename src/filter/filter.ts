/**
 * FilterEngine — multi-criteria filtering optimised for 10 M+ rows.
 *
 * Strategy:
 *  1. If hash-map indexes exist (built via buildIndex), use O(1) lookups per
 *     value and intersect results across fields.  This is the *fast path*.
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

export interface FilterEngineOptions<
  T extends CollectionItem = CollectionItem,
> {
  /**
   * The dataset to index. When provided together with `fields`, all indexes
   * are built automatically inside the constructor — no manual `buildIndex`
   * calls needed.
   *
   * @example
   * ```ts
   * const engine = new FilterEngine<User>({ data: users, fields: ["city", "age"] });
   * engine.filter(users, [{ field: "city", values: ["Kyiv"] }]);
   * ```
   */
  data?: T[];

  /**
   * Fields to build a hash-map index for. Requires `data` to be set as well.
   * When both are present, `buildIndex` is called for each field in the constructor.
   */
  fields?: (keyof T & string)[];

  /**
   * Enables sequential filtering by the previous filter result.
   *
   * When `true`, each call to `filter(criteria)` (without explicit `data`)
   * uses the previous filter output as the next input dataset.
   *
   * @default false
   */
  filterByPreviousResult?: boolean;
}

export class FilterEngine<T extends CollectionItem> {
  private indexer: Indexer<T>;
  private readonly filterByPreviousResult: boolean;

  /** Reference to the full dataset (set via the constructor or `buildIndex`). */
  private data: T[] = [];

  /** Last filter output used as the next input in sequential mode. */
  private previousResult: T[] | null = null;

  /** Last criteria used in sequential mode. */
  private previousCriteria: FilterCriterion<T>[] | null = null;

  /** Dataset reference used to compute previous sequential result. */
  private previousBaseData: T[] | null = null;

  constructor(options: FilterEngineOptions<T> = {}) {
    this.indexer = new Indexer<T>();
    this.filterByPreviousResult = options.filterByPreviousResult ?? false;
    if (!options.data) return;

    this.data = options.data;
    if (!options.fields?.length) return;

    for (const field of options.fields) {
      this.buildIndex(options.data, field);
    }
  }

  /**
   * Build a hash-map index for a field to enable O(1) fast-path filtering.
   *
   * Two call signatures are supported:
   *  - `buildIndex(data, field)` — explicit dataset (original API)
   *  - `buildIndex(field)`       — reuses the dataset supplied in the constructor
   *
   * @returns `this` for chaining.
   */
  buildIndex(data: T[], field: keyof T & string): this;
  buildIndex(field: keyof T & string): this;
  buildIndex(
    dataOrField: T[] | (keyof T & string),
    field?: keyof T & string,
  ): this {
    if (!Array.isArray(dataOrField)) {
      if (!this.data.length) {
        throw new Error(
          "FilterEngine: no dataset in memory. " +
            "Either pass `data` in the constructor options, or call buildIndex(data, field).",
        );
      }

      this.indexer.buildIndex(this.data, dataOrField);
      return this;
    }

    this.data = dataOrField;
    this.previousResult = null;
    this.previousCriteria = null;
    this.previousBaseData = null;
    this.indexer.buildIndex(dataOrField, field!);
    return this;
  }

  /**
   * Free all index memory.
   */
  clearIndexes(): void {
    this.indexer.clear();
  }

  /**
   * Reset sequential filtering state.
   *
   * Useful when `filterByPreviousResult` is enabled and you want
   * the next `filter(criteria)` call to start from the full dataset.
   */
  resetFilterState(): void {
    this.previousResult = null;
    this.previousCriteria = null;
    this.previousBaseData = null;
  }

  /**
   * Apply multiple filter criteria (AND logic).
   *
   * Two call signatures:
   *  - `filter(criteria)`       — uses the dataset supplied in the constructor.
   *  - `filter(data, criteria)` — explicit dataset (original API).
   *
   * @returns Filtered array.
   */
  filter(criteria: FilterCriterion<T>[]): T[];
  filter(data: T[], criteria: FilterCriterion<T>[]): T[];
  filter(
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ): T[] {
    const usesStoredData = criteria === undefined;

    let sourceData: T[];
    let resolvedCriteria: FilterCriterion<T>[];
    let executionCriteria: FilterCriterion<T>[];

    if (usesStoredData) {
      // filter(criteria) — use stored data
      if (!this.data.length) {
        throw new Error(
          "FilterEngine: no dataset in memory. " +
            "Either pass `data` in the constructor options, or call filter(data, criteria).",
        );
      }

      resolvedCriteria = dataOrCriteria as FilterCriterion<T>[];

      if (
        this.filterByPreviousResult &&
        this.previousResult !== null &&
        this.previousCriteria !== null &&
        this.previousBaseData === this.data
      ) {
        const hasAdditions = this.hasCriteriaAdditions(
          this.previousCriteria,
          resolvedCriteria,
        );
        const hasRemovals = this.hasCriteriaRemovals(
          this.previousCriteria,
          resolvedCriteria,
        );

        // No criteria change — return cached sequential result.
        if (!hasAdditions && !hasRemovals) {
          return this.previousResult;
        }

        // Additions only: apply only newly added criteria on previous result.
        if (hasAdditions && !hasRemovals) {
          sourceData = this.previousResult;
          executionCriteria = this.getAddedCriteria(
            this.previousCriteria,
            resolvedCriteria,
          );
        } else {
          // Any removal (or mixed add/remove): recalculate from full dataset.
          sourceData = this.data;
          executionCriteria = resolvedCriteria;
        }
      } else {
        sourceData = this.data;
        executionCriteria = resolvedCriteria;
      }
    } else {
      resolvedCriteria = criteria;
      sourceData = dataOrCriteria as T[];

      if (
        this.filterByPreviousResult &&
        this.previousResult !== null &&
        this.previousCriteria !== null &&
        this.previousBaseData === sourceData
      ) {
        const hasAdditions = this.hasCriteriaAdditions(
          this.previousCriteria,
          resolvedCriteria,
        );
        const hasRemovals = this.hasCriteriaRemovals(
          this.previousCriteria,
          resolvedCriteria,
        );

        if (!hasAdditions && !hasRemovals) {
          return this.previousResult;
        }

        if (hasAdditions && !hasRemovals) {
          sourceData = this.previousResult;
          executionCriteria = this.getAddedCriteria(
            this.previousCriteria,
            resolvedCriteria,
          );
        } else {
          executionCriteria = resolvedCriteria;
        }
      } else {
        executionCriteria = resolvedCriteria;
      }
    }

    if (resolvedCriteria.length === 0) {
      if (this.filterByPreviousResult) {
        this.previousResult = null;
        this.previousCriteria = null;
        this.previousBaseData = null;
      }
      return usesStoredData ? this.data : sourceData;
    }

    // In stored-data mode executionCriteria is always set above.
    if (usesStoredData && !executionCriteria) {
      executionCriteria = resolvedCriteria;
    }

    // --- Separate indexed vs. non-indexed criteria ---
    const { indexedCriteria, linearCriteria } = executionCriteria.reduce(
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
    let result: T[];

    if (indexedCriteria.length > 0 && linearCriteria.length === 0) {
      result = this.filterViaIndex(indexedCriteria, sourceData);
      if (this.filterByPreviousResult) {
        this.previousResult = result;
        this.previousCriteria = this.cloneCriteria(resolvedCriteria);
        this.previousBaseData = usesStoredData
          ? this.data
          : (dataOrCriteria as T[]);
      }
      return result;
    }

    // --- Mixed path: use indexes to narrow candidates, then linear scan ---
    // This avoids O(n) full-dataset scans when indexes can pre-filter.
    if (indexedCriteria.length > 0 && linearCriteria.length > 0) {
      const candidates = this.filterViaIndex(indexedCriteria, sourceData);
      result = this.linearFilter(candidates, linearCriteria);
      if (this.filterByPreviousResult) {
        this.previousResult = result;
        this.previousCriteria = this.cloneCriteria(resolvedCriteria);
        this.previousBaseData = usesStoredData
          ? this.data
          : (dataOrCriteria as T[]);
      }
      return result;
    }

    // --- Pure linear path (no indexes available) ---
    result = this.linearFilter(sourceData, executionCriteria);
    if (this.filterByPreviousResult) {
      this.previousResult = result;
      this.previousCriteria = this.cloneCriteria(resolvedCriteria);
      this.previousBaseData = usesStoredData
        ? this.data
        : (dataOrCriteria as T[]);
    }
    return result;
  }

  private cloneCriteria(criteria: FilterCriterion<T>[]): FilterCriterion<T>[] {
    return criteria.map(({ field, values }) => ({
      field,
      values: [...values],
    }));
  }

  private hasCriteriaAdditions(
    previousCriteria: FilterCriterion<T>[],
    nextCriteria: FilterCriterion<T>[],
  ): boolean {
    const previousByField = new Map<string, Set<any>>(
      previousCriteria.map(({ field, values }) => [field, new Set(values)]),
    );
    const nextByField = new Map<string, Set<any>>(
      nextCriteria.map(({ field, values }) => [field, new Set(values)]),
    );

    for (const [field, nextValues] of nextByField) {
      const previousValues = previousByField.get(field);
      if (!previousValues) {
        return true;
      }

      for (const value of nextValues) {
        if (!previousValues.has(value)) {
          return true;
        }
      }
    }

    return false;
  }

  private hasCriteriaRemovals(
    previousCriteria: FilterCriterion<T>[],
    nextCriteria: FilterCriterion<T>[],
  ): boolean {
    const previousByField = new Map<string, Set<any>>(
      previousCriteria.map(({ field, values }) => [field, new Set(values)]),
    );
    const nextByField = new Map<string, Set<any>>(
      nextCriteria.map(({ field, values }) => [field, new Set(values)]),
    );

    for (const [field, previousValues] of previousByField) {
      const nextValues = nextByField.get(field);
      if (!nextValues) {
        return true;
      }

      for (const value of previousValues) {
        if (!nextValues.has(value)) {
          return true;
        }
      }
    }

    return false;
  }

  private getAddedCriteria(
    previousCriteria: FilterCriterion<T>[],
    nextCriteria: FilterCriterion<T>[],
  ): FilterCriterion<T>[] {
    const previousByField = new Map<string, Set<any>>(
      previousCriteria.map(({ field, values }) => [field, new Set(values)]),
    );

    const addedCriteria: FilterCriterion<T>[] = [];

    for (const { field, values } of nextCriteria) {
      const previousValues = previousByField.get(field);
      if (!previousValues) {
        addedCriteria.push({ field, values: [...values] });
        continue;
      }

      const addedValues = values.filter((value) => !previousValues.has(value));
      if (addedValues.length > 0) {
        addedCriteria.push({ field, values: addedValues });
      }
    }

    return addedCriteria;
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

    // Single-pass filter with early exit per item.
    const result: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      let matchesAllCriteria = true;

      for (
        let fieldIndex = 0;
        fieldIndex < criterionFields.length;
        fieldIndex++
      ) {
        const field = criterionFields[fieldIndex];
        if (!acceptableValuesByField.get(field)!.has(item[field])) {
          matchesAllCriteria = false;
          break;
        }
      }

      if (matchesAllCriteria) {
        result.push(item);
      }
    }

    return result;
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
  private filterViaIndex(criteria: FilterCriterion<T>[], sourceData: T[]): T[] {
    const isFilteringFromSubset = sourceData !== this.data;
    const allowedItems = isFilteringFromSubset ? new Set(sourceData) : null;

    // For a single criterion, just grab from the index
    if (criteria.length === 1) {
      const indexedResult = this.indexer.getByValues(
        criteria[0].field,
        criteria[0].values,
      );
      if (!allowedItems) return indexedResult;

      return indexedResult.filter((item) => allowedItems.has(item));
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

    // Single-pass filter over candidates with early exit per item.
    const result: T[] = [];

    for (
      let candidateIndex = 0;
      candidateIndex < candidateItems.length;
      candidateIndex++
    ) {
      const item = candidateItems[candidateIndex];
      let matchesAllRemainingCriteria = true;

      for (
        let fieldIndex = 0;
        fieldIndex < remainingFields.length;
        fieldIndex++
      ) {
        const field = remainingFields[fieldIndex];
        if (!remainingValuesByField.get(field)!.has(item[field])) {
          matchesAllRemainingCriteria = false;
          break;
        }
      }

      if (
        matchesAllRemainingCriteria &&
        allowedItems &&
        !allowedItems.has(item)
      ) {
        matchesAllRemainingCriteria = false;
      }

      if (matchesAllRemainingCriteria) {
        result.push(item);
      }
    }

    return result;
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
