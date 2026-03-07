/**
 * FilterEngine class for filtering collections by multiple criteria,
 * supporting indexed lookups and linear scans for large datasets.
 */

import { CollectionItem, FilterCriterion } from "../types";
import { Indexer } from "../indexer";
import { FilterEngineChain, FilterEngineChainBuilder } from "./chain";
import { FilterEngineError } from "./errors";

export interface FilterEngineOptions<
  T extends CollectionItem = CollectionItem,
> {
  data?: T[];

  fields?: (keyof T & string)[];

  nestedFields?: string[];

  filterByPreviousResult?: boolean;
}

type NestedFieldDescriptor = {
  collectionKey: string;
  nestedKey: string;
};

export class FilterEngine<T extends CollectionItem> {
  private indexer: Indexer<T>;
  private readonly filterByPreviousResult: boolean;

  private dataset: T[] = [];

  private readonly indexedFields = new Set<keyof T & string>();

  private readonly nestedIndexedFields = new Set<string>();

  private readonly nestedFieldDescriptors = new Map<
    string,
    NestedFieldDescriptor
  >();

  private nestedIndexes = new Map<string, Map<any, T[]>>();

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

    if (options.nestedFields?.length) {
      for (const nestedField of options.nestedFields) {
        this.registerNestedField(nestedField);
      }
    }

    if (!options.data) return;

    this.dataset = options.data;

    const hasFields = options.fields?.length;
    const hasNestedFields = this.nestedIndexedFields.size > 0;

    if (hasFields) {
      for (const field of options.fields!) {
        this.indexedFields.add(field);
      }
    }

    if (hasFields || hasNestedFields) {
      this.rebuildConfiguredIndexes();
    }
  }

  private rebuildConfiguredIndexes(): void {
    this.indexer.clear();
    this.nestedIndexes.clear();

    for (const field of this.indexedFields) {
      this.buildIndex(this.dataset, field);
    }

    for (const nestedField of this.nestedIndexedFields) {
      this.buildNestedFilterIndex(this.dataset, nestedField);
    }
  }

  private registerNestedField(fieldPath: string): void {
    const descriptor = this.createNestedFieldDescriptor(fieldPath);
    if (!descriptor) return;

    this.nestedIndexedFields.add(fieldPath);
    this.nestedFieldDescriptors.set(fieldPath, descriptor);
  }

  private createNestedFieldDescriptor(
    fieldPath: string,
  ): NestedFieldDescriptor | null {
    const dotIndex = fieldPath.indexOf(".");
    if (dotIndex === -1) return null;

    return {
      collectionKey: fieldPath.substring(0, dotIndex),
      nestedKey: fieldPath.substring(dotIndex + 1),
    };
  }

  /**
   * Builds an index for the given field.
   */
  private buildIndex(data: T[], field: keyof T & string): this;
  private buildIndex(field: keyof T & string): this;
  private buildIndex(
    dataOrField: T[] | (keyof T & string),
    field?: keyof T & string,
  ): this {
    if (!Array.isArray(dataOrField)) {
      if (!this.dataset.length) {
        throw FilterEngineError.missingDatasetForBuildIndex();
      }

      this.indexer.buildIndex(this.dataset, dataOrField);
      return this;
    }

    this.dataset = dataOrField;
    this.previousResult = null;
    this.previousCriteria = null;
    this.previousBaseData = null;
    this.indexer.buildIndex(dataOrField, field!);
    return this;
  }

  clearIndexes(): this {
    this.indexer.clear();
    this.nestedIndexes.clear();
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
    this.nestedIndexes.clear();
    this.resetFilterState();
    return this;
  }

  data(data: T[]): this {
    this.dataset = data;
    this.resetFilterState();
    this.rebuildConfiguredIndexes();
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
          return this.withChain(this.previousResult);
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
          return this.withChain(this.previousResult);
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
      return this.withChain(usesStoredData ? this.dataset : sourceData);
    }

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
      if (this.nestedIndexedFields.has(criterion.field)) {
        nestedCriteria.push(criterion);
      } else {
        flatCriteria.push(criterion);
      }
    }

    if (nestedCriteria.length > 0) {
      sourceData = this.filterByNested(sourceData, nestedCriteria);
      if (sourceData.length === 0) {
        const emptyResult: T[] = [];
        if (this.filterByPreviousResult) {
          this.previousResult = emptyResult;
          this.previousCriteria = this.cloneCriteria(resolvedCriteria);
          this.previousBaseData = usesStoredData
            ? this.dataset
            : (dataOrCriteria as T[]);
        }
        return this.withChain(emptyResult);
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
      return this.withChain(sourceData);
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
      return this.withChain(result);
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
      return this.withChain(result);
    }

    result = this.linearFilter(sourceData, flatCriteria);
    if (this.filterByPreviousResult) {
      this.previousResult = result;
      this.previousCriteria = this.cloneCriteria(resolvedCriteria);
      this.previousBaseData = usesStoredData
        ? this.dataset
        : (dataOrCriteria as T[]);
    }
    return this.withChain(result);
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

  /**
   * Builds an index for a nested collection field (e.g. "orders.status").
   */
  private buildNestedFilterIndex(data: T[], nestedFieldPath: string): void {
    const descriptor = this.nestedFieldDescriptors.get(nestedFieldPath);
    if (!descriptor) return;

    const { collectionKey, nestedKey } = descriptor;
    const indexMap = new Map<any, T[]>();

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const item = data[itemIndex];
      const collection = item[collectionKey];
      if (!Array.isArray(collection)) continue;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const value = collection[nestedIndex][nestedKey];
        if (value === undefined || value === null) continue;

        const bucket = indexMap.get(value);
        if (bucket) {
          if (bucket[bucket.length - 1] !== item) {
            bucket.push(item);
          }
        } else {
          indexMap.set(value, [item]);
        }
      }
    }

    this.nestedIndexes.set(nestedFieldPath, indexMap);
  }

  /**
   * Filters source data by nested criteria using indexes or linear scan.
   */
  private filterByNested(
    sourceData: T[],
    nestedCriteria: FilterCriterion<T>[],
  ): T[] {
    if (sourceData.length === 0 || nestedCriteria.length === 0) {
      return sourceData;
    }

    const indexedCriteria: FilterCriterion<T>[] = [];
    const linearCriteria: FilterCriterion<T>[] = [];

    for (
      let criterionIndex = 0;
      criterionIndex < nestedCriteria.length;
      criterionIndex++
    ) {
      const criterion = nestedCriteria[criterionIndex];
      if (this.nestedIndexes.has(criterion.field)) {
        indexedCriteria.push(criterion);
      } else {
        linearCriteria.push(criterion);
      }
    }

    let result = sourceData;
    const allowedItems =
      sourceData === this.dataset ? null : new Set(sourceData);

    if (indexedCriteria.length > 0) {
      result = this.filterByNestedIndexes(indexedCriteria, allowedItems);

      if (result.length === 0) return result;
    }

    for (
      let criterionIndex = 0;
      criterionIndex < linearCriteria.length;
      criterionIndex++
    ) {
      result = this.filterNestedLinear(result, linearCriteria[criterionIndex]);
      if (result.length === 0) return result;
    }

    return result;
  }

  /**
   * Filters nested criteria using parent item indexes.
   */
  private filterByNestedIndexes(
    criteria: FilterCriterion<T>[],
    allowedItems: Set<T> | null,
  ): T[] {
    if (criteria.length === 1) {
      const nestedIndex = this.nestedIndexes.get(criteria[0].field);
      if (!nestedIndex) return [];

      const matchingItems = this.getNestedItemsByValues(
        nestedIndex,
        criteria[0].values,
      );
      if (matchingItems.length === 0) return [];

      if (allowedItems === null) {
        return matchingItems;
      }

      const filteredItems: T[] = [];

      for (let itemIndex = 0; itemIndex < matchingItems.length; itemIndex++) {
        const item = matchingItems[itemIndex];
        if (allowedItems.has(item)) {
          filteredItems.push(item);
        }
      }

      return filteredItems;
    }

    const estimatedCriteria = criteria
      .map((criterion) => ({
        criterion,
        size: this.estimateNestedIndexSize(criterion),
      }))
      .sort(
        (leftEstimate, rightEstimate) => leftEstimate.size - rightEstimate.size,
      );

    let currentAllowedItems = allowedItems;
    let matchingItems: T[] = [];

    for (
      let criterionIndex = 0;
      criterionIndex < estimatedCriteria.length;
      criterionIndex++
    ) {
      const { criterion } = estimatedCriteria[criterionIndex];
      const nestedIndex = this.nestedIndexes.get(criterion.field);

      if (!nestedIndex) return [];

      const nextMatchingItems = this.getNestedItemsByValues(
        nestedIndex,
        criterion.values,
      );
      if (nextMatchingItems.length === 0) return [];

      if (currentAllowedItems === null) {
        matchingItems = nextMatchingItems;
      } else {
        matchingItems = [];

        for (
          let itemIndex = 0;
          itemIndex < nextMatchingItems.length;
          itemIndex++
        ) {
          const item = nextMatchingItems[itemIndex];
          if (currentAllowedItems.has(item)) {
            matchingItems.push(item);
          }
        }
      }

      if (matchingItems.length === 0) return [];

      currentAllowedItems = new Set<T>(matchingItems);
    }

    return matchingItems;
  }

  /**
   * Gets parent item indexes matching any of the given values from a nested index.
   */
  private getNestedItemsByValues(
    nestedIndex: Map<any, T[]>,
    values: any[],
  ): T[] {
    if (values.length === 1) {
      return nestedIndex.get(values[0]) ?? [];
    }

    const seenItems = new Set<T>();
    const result: T[] = [];

    for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
      const bucket = nestedIndex.get(values[valueIndex]);
      if (!bucket) continue;

      for (let itemIndex = 0; itemIndex < bucket.length; itemIndex++) {
        const item = bucket[itemIndex];
        if (!seenItems.has(item)) {
          seenItems.add(item);
          result.push(item);
        }
      }
    }

    return result;
  }

  /**
   * Estimates the size of the nested index for a criterion.
   */
  private estimateNestedIndexSize(criterion: FilterCriterion<T>): number {
    const nestedIndex = this.nestedIndexes.get(criterion.field);
    if (!nestedIndex) return Infinity;

    return criterion.values.reduce((totalSize, value) => {
      const bucket = nestedIndex.get(value);
      return bucket ? totalSize + bucket.length : totalSize;
    }, 0);
  }

  /**
   * Linearly filters data by a nested field criterion.
   */
  private filterNestedLinear(data: T[], criterion: FilterCriterion<T>): T[] {
    const descriptor = this.nestedFieldDescriptors.get(criterion.field);
    if (!descriptor) return data;

    const { collectionKey, nestedKey } = descriptor;
    const acceptableValues = new Set(criterion.values);
    const result: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const collection = data[itemIndex][collectionKey];
      if (!Array.isArray(collection)) continue;

      let hasMatch = false;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        if (acceptableValues.has(collection[nestedIndex][nestedKey])) {
          hasMatch = true;
          break;
        }
      }

      if (hasMatch) {
        result.push(data[itemIndex]);
      }
    }

    return result;
  }
}
