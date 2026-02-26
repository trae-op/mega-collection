/**
 * FilterEngine class for filtering collections by multiple criteria,
 * supporting indexed lookups and linear scans for large datasets.
 */

import { CollectionItem, FilterCriterion } from "../types";
import { Indexer } from "../indexer";

export interface FilterEngineOptions<
  T extends CollectionItem = CollectionItem,
> {
  data?: T[];

  fields?: (keyof T & string)[];

  filterByPreviousResult?: boolean;
}

export class FilterEngine<T extends CollectionItem> {
  private indexer: Indexer<T>;
  private readonly filterByPreviousResult: boolean;

  private data: T[] = [];

  private previousResult: T[] | null = null;

  private previousCriteria: FilterCriterion<T>[] | null = null;

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

  private buildIndex(data: T[], field: keyof T & string): this;
  private buildIndex(field: keyof T & string): this;
  private buildIndex(
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

  clearIndexes(): void {
    this.indexer.clear();
  }

  resetFilterState(): void {
    this.previousResult = null;
    this.previousCriteria = null;
    this.previousBaseData = null;
  }

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

    if (usesStoredData && !executionCriteria) {
      executionCriteria = resolvedCriteria;
    }

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

  private filterViaIndex(criteria: FilterCriterion<T>[], sourceData: T[]): T[] {
    const isFilteringFromSubset = sourceData !== this.data;
    const allowedItems = isFilteringFromSubset ? new Set(sourceData) : null;

    if (criteria.length === 1) {
      const indexedResult = this.indexer.getByValues(
        criteria[0].field,
        criteria[0].values,
      );
      if (!allowedItems) return indexedResult;

      return indexedResult.filter((item) => allowedItems.has(item));
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

  private estimateIndexSize(criterion: FilterCriterion<T>): number {
    const indexMap = this.indexer.getIndexMap(criterion.field);
    if (!indexMap) return Infinity;

    return criterion.values.reduce((totalSize, value) => {
      const bucket = indexMap.get(value);
      return bucket ? totalSize + bucket.length : totalSize;
    }, 0);
  }
}
