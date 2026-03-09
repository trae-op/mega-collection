/**
 * FilterEngine class for filtering collections by multiple criteria,
 * supporting indexed lookups and linear scans for large datasets.
 */

import { CollectionItem, FilterCriterion } from "../types";
import { Indexer } from "../indexer";
import { FilterEngineChain, FilterEngineChainBuilder } from "./chain";
import type { FilterEngineOptions } from "./types";
import { FilterEngineError } from "./errors";
import { FILTER_ENGINE_EXECUTE } from "./internal";
import { FilterNestedCollection } from "./nested";

export class FilterEngine<T extends CollectionItem> {
  private indexer: Indexer<T>;
  private readonly filterByPreviousResult: boolean;

  private dataset: T[] = [];

  private readonly indexedFields = new Set<keyof T & string>();

  private readonly nestedCollection = new FilterNestedCollection<T>();

  private previousResult: T[] | null = null;

  private previousCriteria: FilterCriterion<T>[] | null = null;

  private previousBaseData: T[] | null = null;

  private readonly chainBuilder = new FilterEngineChainBuilder<T>({
    filter: (dataOrCriteria, criteria) => {
      if (criteria === undefined) {
        return this.filter(dataOrCriteria as FilterCriterion<T>[]);
      }

      return this.filter(dataOrCriteria as T[], criteria);
    },
    getOriginData: () => this.getOriginData(),
    data: (data) => this.data(data),
    clearIndexes: () => this.clearIndexes(),
    clearData: () => this.clearData(),
    resetFilterState: () => this.resetFilterState(),
  });

  /**
   * Creates a new FilterEngine with optional data and fields to index.
   */
  constructor(options: FilterEngineOptions<T> = {}) {
    this.indexer = new Indexer<T>();
    this.filterByPreviousResult = options.filterByPreviousResult ?? false;
    this.nestedCollection.registerFields(options.nestedFields);

    if (!options.data) return;

    this.dataset = options.data;

    if (options.fields?.length) {
      for (const field of options.fields!) {
        this.indexedFields.add(field);
      }
    }
  }

  private ensureConfiguredFieldIndex(field: keyof T & string): void {
    if (!this.indexedFields.has(field)) return;
    if (this.indexer.hasIndex(field)) return;
    if (this.dataset.length === 0) return;

    this.indexer.buildIndex(this.dataset, field);
  }

  private ensureIndexesForCriteria(criteria: FilterCriterion<T>[]): void {
    if (this.dataset.length === 0) return;

    for (
      let criterionIndex = 0;
      criterionIndex < criteria.length;
      criterionIndex++
    ) {
      const field = criteria[criterionIndex].field;

      if (this.nestedCollection.hasField(field)) {
        this.nestedCollection.ensureIndex(this.dataset, field);
        continue;
      }

      this.ensureConfiguredFieldIndex(field as keyof T & string);
    }
  }

  clearIndexes(): this {
    this.indexer.clear();
    this.nestedCollection.clearIndexes();
    return this;
  }

  resetFilterState(): this {
    this.previousResult = null;
    this.previousCriteria = null;
    this.previousBaseData = null;
    return this;
  }

  clearData(): this {
    this.dataset = [];
    this.indexer.clear();
    this.nestedCollection.clearIndexes();
    this.resetFilterState();
    return this;
  }

  data(data: T[]): this {
    this.dataset = data;
    this.resetFilterState();
    this.clearIndexes();
    return this;
  }

  getOriginData(): T[] {
    return this.dataset;
  }

  /**
   * Filters the data based on the given criteria.
   */
  filter(criteria: FilterCriterion<T>[]): T[] & FilterEngineChain<T>;
  filter(data: T[], criteria: FilterCriterion<T>[]): T[] & FilterEngineChain<T>;
  filter(
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ): T[] & FilterEngineChain<T> {
    if (criteria === undefined) {
      return this.withChain(
        this[FILTER_ENGINE_EXECUTE](dataOrCriteria as FilterCriterion<T>[]),
      );
    }

    return this.withChain(
      this[FILTER_ENGINE_EXECUTE](dataOrCriteria as T[], criteria),
    );
  }

  [FILTER_ENGINE_EXECUTE](criteria: FilterCriterion<T>[]): T[];
  [FILTER_ENGINE_EXECUTE](data: T[], criteria: FilterCriterion<T>[]): T[];
  [FILTER_ENGINE_EXECUTE](
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ): T[] {
    const usesStoredData = criteria === undefined;

    let sourceData: T[];
    let resolvedCriteria: FilterCriterion<T>[];
    let executionCriteria: FilterCriterion<T>[];

    if (usesStoredData) {
      if (!this.dataset.length) {
        throw FilterEngineError.missingDatasetForFilter();
      }

      resolvedCriteria = dataOrCriteria as FilterCriterion<T>[];

      if (
        this.filterByPreviousResult &&
        this.previousResult !== null &&
        this.previousCriteria !== null &&
        this.previousBaseData === this.dataset
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
          sourceData = this.dataset;
          executionCriteria = resolvedCriteria;
        }
      } else {
        sourceData = this.dataset;
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
      return usesStoredData ? this.dataset : sourceData;
    }

    this.ensureIndexesForCriteria(executionCriteria);

    if (usesStoredData && !executionCriteria) {
      executionCriteria = resolvedCriteria;
    }

    const nestedCriteria: FilterCriterion<T>[] = [];
    const flatCriteria: FilterCriterion<T>[] = [];

    for (
      let criterionIndex = 0;
      criterionIndex < executionCriteria.length;
      criterionIndex++
    ) {
      const criterion = executionCriteria[criterionIndex];
      if (this.nestedCollection.hasField(criterion.field)) {
        nestedCriteria.push(criterion);
      } else {
        flatCriteria.push(criterion);
      }
    }

    if (nestedCriteria.length > 0) {
      sourceData = this.nestedCollection.filter(
        sourceData,
        nestedCriteria,
        this.dataset,
      );
      if (sourceData.length === 0) {
        const emptyResult: T[] = [];
        if (this.filterByPreviousResult) {
          this.previousResult = emptyResult;
          this.previousCriteria = this.cloneCriteria(resolvedCriteria);
          this.previousBaseData = usesStoredData
            ? this.dataset
            : (dataOrCriteria as T[]);
        }
        return emptyResult;
      }
    }

    if (flatCriteria.length === 0) {
      if (this.filterByPreviousResult) {
        this.previousResult = sourceData;
        this.previousCriteria = this.cloneCriteria(resolvedCriteria);
        this.previousBaseData = usesStoredData
          ? this.dataset
          : (dataOrCriteria as T[]);
      }
      return sourceData;
    }

    const { indexedCriteria, linearCriteria } = flatCriteria.reduce(
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

    let result: T[];

    if (indexedCriteria.length > 0 && linearCriteria.length === 0) {
      result = this.filterViaIndex(indexedCriteria, sourceData);
      if (this.filterByPreviousResult) {
        this.previousResult = result;
        this.previousCriteria = this.cloneCriteria(resolvedCriteria);
        this.previousBaseData = usesStoredData
          ? this.dataset
          : (dataOrCriteria as T[]);
      }
      return result;
    }

    if (indexedCriteria.length > 0 && linearCriteria.length > 0) {
      const candidates = this.filterViaIndex(indexedCriteria, sourceData);
      result = this.linearFilter(candidates, linearCriteria);
      if (this.filterByPreviousResult) {
        this.previousResult = result;
        this.previousCriteria = this.cloneCriteria(resolvedCriteria);
        this.previousBaseData = usesStoredData
          ? this.dataset
          : (dataOrCriteria as T[]);
      }
      return result;
    }

    result = this.linearFilter(sourceData, flatCriteria);
    if (this.filterByPreviousResult) {
      this.previousResult = result;
      this.previousCriteria = this.cloneCriteria(resolvedCriteria);
      this.previousBaseData = usesStoredData
        ? this.dataset
        : (dataOrCriteria as T[]);
    }
    return result;
  }

  private withChain(result: T[]): T[] & FilterEngineChain<T> {
    return this.chainBuilder.create(result);
  }

  private cloneCriteria(criteria: FilterCriterion<T>[]): FilterCriterion<T>[] {
    return criteria.map(({ field, values }) => ({
      field,
      values: [...values],
    }));
  }

  /**
   * Checks if there are new criteria added.
   */
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

  /**
   * Checks if there are criteria removed.
   */
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

  /**
   * Gets the newly added criteria.
   */
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
   * Filters data linearly without index.
   */
  private linearFilter(data: T[], criteria: FilterCriterion<T>[]): T[] {
    const acceptableValuesByField = new Map<string, Set<any>>(
      criteria.map(({ field, values }) => [field, new Set(values)]),
    );
    const criterionFields = criteria.map(({ field }) => field);

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
   * Filters data using the index.
   */
  private filterViaIndex(criteria: FilterCriterion<T>[], sourceData: T[]): T[] {
    const isFilteringFromSubset = sourceData !== this.dataset;
    const allowedItems = isFilteringFromSubset ? new Set(sourceData) : null;

    if (criteria.length === 1) {
      const indexedResult = this.indexer.getByValues(
        criteria[0].field,
        criteria[0].values,
      );
      if (!allowedItems) {
        return indexedResult.slice();
      }

      const filteredItems: T[] = [];

      for (let itemIndex = 0; itemIndex < indexedResult.length; itemIndex++) {
        const item = indexedResult[itemIndex];
        if (allowedItems.has(item)) {
          filteredItems.push(item);
        }
      }

      return filteredItems;
    }

    const estimatedCriteria = criteria
      .map((criterion) => ({
        criterion,
        size: this.estimateIndexSize(criterion),
      }))
      .sort(
        (leftEstimate, rightEstimate) => leftEstimate.size - rightEstimate.size,
      );

    const { field: mostSelectiveField, values: mostSelectiveValues } =
      estimatedCriteria[0].criterion;
    const candidateItems = this.indexer.getByValues(
      mostSelectiveField,
      mostSelectiveValues,
    );

    if (candidateItems.length === 0) return [];

    const remainingValuesByField = new Map<string, Set<any>>(
      estimatedCriteria
        .slice(1)
        .map(({ criterion: { field, values } }) => [field, new Set(values)]),
    );
    const remainingFields = Array.from(remainingValuesByField.keys());

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
   * Estimates the size of the index for a criterion.
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
