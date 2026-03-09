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
import {
  isCriterionUnsatisfiable,
  matchesCriterionValue,
  resolveCriteria,
  type ResolvedFilterCriterion,
} from "./criterion";
import { FilterNestedCollection } from "./nested";

export class FilterEngine<T extends CollectionItem> {
  private indexer: Indexer<T>;
  private readonly filterByPreviousResult: boolean;

  private readonly mutableExcludeField: (keyof T & string) | null;

  private dataset: T[] = [];

  private readonly datasetPositions = new Map<any, number>();

  private hasDuplicateMutableExcludeValues = false;

  private readonly indexedFields = new Set<keyof T & string>();

  private readonly nestedCollection = new FilterNestedCollection<T>();

  private previousResult: T[] | null = null;

  private previousCriteria: ResolvedFilterCriterion<T>[] | null = null;

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
    this.mutableExcludeField = options.mutableExcludeField ?? null;
    this.nestedCollection.registerFields(options.nestedFields);

    if (!options.data) return;

    this.dataset = options.data;
    this.rebuildMutableExcludeState();

    const hasFields = options.fields?.length;
    const hasNestedFields = this.nestedCollection.hasRegisteredFields();

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
    this.nestedCollection.clearIndexes();

    for (const field of this.indexedFields) {
      this.buildIndex(this.dataset, field);
    }

    if (this.nestedCollection.hasRegisteredFields()) {
      this.nestedCollection.buildIndexes(this.dataset);
    }
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
    this.resetFilterState();
    this.rebuildMutableExcludeState();
    this.indexer.buildIndex(dataOrField, field!);
    return this;
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
    this.datasetPositions.clear();
    this.hasDuplicateMutableExcludeValues = false;
    this.indexer.clear();
    this.nestedCollection.clearIndexes();
    this.resetFilterState();
    return this;
  }

  data(data: T[]): this {
    this.dataset = data;
    this.rebuildMutableExcludeState();
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
    let resolvedCriteria: ResolvedFilterCriterion<T>[];
    let executionCriteria: ResolvedFilterCriterion<T>[];

    if (usesStoredData) {
      if (!this.dataset.length) {
        throw FilterEngineError.missingDatasetForFilter();
      }

      resolvedCriteria = resolveCriteria(
        dataOrCriteria as FilterCriterion<T>[],
      );

      const mutableExcludeResult = this.applyMutableExclude(resolvedCriteria);
      if (mutableExcludeResult !== undefined) {
        return mutableExcludeResult;
      }

      if (
        this.filterByPreviousResult &&
        this.previousResult !== null &&
        this.previousCriteria !== null &&
        this.previousBaseData === this.dataset
      ) {
        const transition = this.getCriteriaTransition(
          this.previousCriteria,
          resolvedCriteria,
        );

        if (transition === "unchanged") {
          return this.previousResult;
        }

        if (transition === "narrowed") {
          sourceData = this.previousResult;
          executionCriteria = resolvedCriteria;
        } else {
          sourceData = this.dataset;
          executionCriteria = resolvedCriteria;
        }
      } else {
        sourceData = this.dataset;
        executionCriteria = resolvedCriteria;
      }
    } else {
      resolvedCriteria = resolveCriteria(criteria);
      sourceData = dataOrCriteria as T[];

      if (
        this.filterByPreviousResult &&
        this.previousResult !== null &&
        this.previousCriteria !== null &&
        this.previousBaseData === sourceData
      ) {
        const transition = this.getCriteriaTransition(
          this.previousCriteria,
          resolvedCriteria,
        );

        if (transition === "unchanged") {
          return this.previousResult;
        }

        if (transition === "narrowed") {
          sourceData = this.previousResult;
          executionCriteria = resolvedCriteria;
        } else {
          executionCriteria = resolvedCriteria;
        }
      } else {
        executionCriteria = resolvedCriteria;
      }
    }

    if (resolvedCriteria.length === 0) {
      if (this.filterByPreviousResult) {
        this.resetFilterState();
      }
      return usesStoredData ? this.dataset : sourceData;
    }

    for (
      let criterionIndex = 0;
      criterionIndex < executionCriteria.length;
      criterionIndex++
    ) {
      if (!isCriterionUnsatisfiable(executionCriteria[criterionIndex])) {
        continue;
      }

      return this.createEmptyResult(
        usesStoredData,
        dataOrCriteria as T[],
        resolvedCriteria,
      );
    }

    const nestedCriteria: ResolvedFilterCriterion<T>[] = [];
    const flatCriteria: ResolvedFilterCriterion<T>[] = [];

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
        return this.createEmptyResult(
          usesStoredData,
          dataOrCriteria as T[],
          resolvedCriteria,
        );
      }
    }

    if (flatCriteria.length === 0) {
      this.storePreviousResult(
        sourceData,
        usesStoredData,
        dataOrCriteria as T[],
        resolvedCriteria,
      );
      return sourceData;
    }

    const { indexedCriteria, linearCriteria } = flatCriteria.reduce(
      (
        accumulator: {
          indexedCriteria: ResolvedFilterCriterion<T>[];
          linearCriteria: ResolvedFilterCriterion<T>[];
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
      this.storePreviousResult(
        result,
        usesStoredData,
        dataOrCriteria as T[],
        resolvedCriteria,
      );
      return result;
    }

    if (indexedCriteria.length > 0 && linearCriteria.length > 0) {
      const candidates = this.filterViaIndex(indexedCriteria, sourceData);
      result = this.linearFilter(candidates, linearCriteria);
      this.storePreviousResult(
        result,
        usesStoredData,
        dataOrCriteria as T[],
        resolvedCriteria,
      );
      return result;
    }

    result = this.linearFilter(sourceData, flatCriteria);
    this.storePreviousResult(
      result,
      usesStoredData,
      dataOrCriteria as T[],
      resolvedCriteria,
    );
    return result;
  }

  private withChain(result: T[]): T[] & FilterEngineChain<T> {
    return this.chainBuilder.create(result);
  }

  private rebuildMutableExcludeState(): void {
    this.datasetPositions.clear();
    this.hasDuplicateMutableExcludeValues = false;

    if (this.mutableExcludeField === null) {
      return;
    }

    for (let itemIndex = 0; itemIndex < this.dataset.length; itemIndex++) {
      const item = this.dataset[itemIndex];
      const fieldValue = item[this.mutableExcludeField];

      if (fieldValue === undefined || fieldValue === null) {
        continue;
      }

      if (this.datasetPositions.has(fieldValue)) {
        this.hasDuplicateMutableExcludeValues = true;
      }

      this.datasetPositions.set(fieldValue, itemIndex);
    }
  }

  private applyMutableExclude(
    criteria: ResolvedFilterCriterion<T>[],
  ): T[] | undefined {
    if (this.mutableExcludeField === null || criteria.length !== 1) {
      return undefined;
    }

    const criterion = criteria[0];

    if (
      criterion.field !== this.mutableExcludeField ||
      criterion.hasValues ||
      !criterion.hasExclude
    ) {
      return undefined;
    }

    if (this.hasDuplicateMutableExcludeValues) {
      throw FilterEngineError.duplicateMutableExcludeField(
        this.mutableExcludeField,
      );
    }

    for (
      let valueIndex = 0;
      valueIndex < criterion.exclude.length;
      valueIndex++
    ) {
      this.removeStoredItem(criterion.exclude[valueIndex]);
    }

    this.resetFilterState();
    return this.dataset;
  }

  private removeStoredItem(fieldValue: any): void {
    const itemIndex = this.datasetPositions.get(fieldValue);
    if (itemIndex === undefined) {
      return;
    }

    const lastIndex = this.dataset.length - 1;
    const removedItem = this.dataset[itemIndex];
    const lastItem = this.dataset[lastIndex];

    this.indexer.removeItem(removedItem);
    this.nestedCollection.removeItem(removedItem);

    if (itemIndex !== lastIndex) {
      this.dataset[itemIndex] = lastItem;

      if (this.mutableExcludeField !== null) {
        const movedValue = lastItem[this.mutableExcludeField];
        if (movedValue !== undefined && movedValue !== null) {
          this.datasetPositions.set(movedValue, itemIndex);
        }
      }
    }

    this.dataset.pop();
    this.datasetPositions.delete(fieldValue);
  }

  /**
   * Filters data linearly without index.
   */
  private linearFilter(data: T[], criteria: ResolvedFilterCriterion<T>[]): T[] {
    const result: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      let matchesAllCriteria = true;

      for (
        let criterionIndex = 0;
        criterionIndex < criteria.length;
        criterionIndex++
      ) {
        const criterion = criteria[criterionIndex];
        if (!matchesCriterionValue(criterion, item[criterion.field])) {
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
  private filterViaIndex(
    criteria: ResolvedFilterCriterion<T>[],
    sourceData: T[],
  ): T[] {
    const isFilteringFromSubset = sourceData !== this.dataset;
    const allowedItems = isFilteringFromSubset ? new Set(sourceData) : null;
    const inclusionCriteria = criteria.filter(
      (criterion) => criterion.hasValues,
    );
    const exclusionCriteria = criteria.filter(
      (criterion) => criterion.hasExclude,
    );

    if (inclusionCriteria.length === 0) {
      return this.applyIndexedExclusions(sourceData, exclusionCriteria);
    }

    if (inclusionCriteria.length === 1) {
      const indexedResult = this.indexer.getByValues(
        inclusionCriteria[0].field,
        inclusionCriteria[0].values,
      );
      const matchingItems: T[] = [];

      for (let itemIndex = 0; itemIndex < indexedResult.length; itemIndex++) {
        const item = indexedResult[itemIndex];
        if (allowedItems && !allowedItems.has(item)) {
          continue;
        }

        if (
          !matchesCriterionValue(
            inclusionCriteria[0],
            item[inclusionCriteria[0].field],
          )
        ) {
          continue;
        }

        matchingItems.push(item);
      }

      return this.applyIndexedExclusions(matchingItems, exclusionCriteria);
    }

    const estimatedCriteria = inclusionCriteria
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

    const result: T[] = [];

    for (
      let candidateIndex = 0;
      candidateIndex < candidateItems.length;
      candidateIndex++
    ) {
      const item = candidateItems[candidateIndex];
      let matchesAllCriteria = true;

      if (allowedItems && !allowedItems.has(item)) {
        continue;
      }

      for (
        let criterionIndex = 0;
        criterionIndex < estimatedCriteria.length;
        criterionIndex++
      ) {
        const criterion = estimatedCriteria[criterionIndex].criterion;
        if (!matchesCriterionValue(criterion, item[criterion.field])) {
          matchesAllCriteria = false;
          break;
        }
      }

      if (matchesAllCriteria) {
        result.push(item);
      }
    }

    return this.applyIndexedExclusions(result, exclusionCriteria);
  }

  /**
   * Estimates the size of the index for a criterion.
   */
  private estimateIndexSize(criterion: ResolvedFilterCriterion<T>): number {
    const indexMap = this.indexer.getIndexMap(criterion.field);
    if (!indexMap) return Infinity;

    return criterion.values.reduce((totalSize, value) => {
      const bucket = indexMap.get(value);
      return bucket ? totalSize + bucket.length : totalSize;
    }, 0);
  }

  private applyIndexedExclusions(
    data: T[],
    criteria: ResolvedFilterCriterion<T>[],
  ): T[] {
    if (criteria.length === 0 || data.length === 0) {
      return data.slice();
    }

    const excludedItems = new Set<T>();

    for (
      let criterionIndex = 0;
      criterionIndex < criteria.length;
      criterionIndex++
    ) {
      const criterion = criteria[criterionIndex];
      const indexMap = this.indexer.getIndexMap(criterion.field);
      if (!indexMap) {
        continue;
      }

      for (
        let valueIndex = 0;
        valueIndex < criterion.exclude.length;
        valueIndex++
      ) {
        const bucket = indexMap.get(criterion.exclude[valueIndex]);
        if (!bucket) {
          continue;
        }

        for (let itemIndex = 0; itemIndex < bucket.length; itemIndex++) {
          excludedItems.add(bucket[itemIndex]);
        }
      }
    }

    if (excludedItems.size === 0) {
      return data.slice();
    }

    const result: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      if (!excludedItems.has(item)) {
        result.push(item);
      }
    }

    return result;
  }

  private createEmptyResult(
    usesStoredData: boolean,
    baseData: T[],
    resolvedCriteria: ResolvedFilterCriterion<T>[],
  ): T[] {
    const emptyResult: T[] = [];
    this.storePreviousResult(
      emptyResult,
      usesStoredData,
      baseData,
      resolvedCriteria,
    );
    return emptyResult;
  }

  private storePreviousResult(
    result: T[],
    usesStoredData: boolean,
    baseData: T[],
    resolvedCriteria: ResolvedFilterCriterion<T>[],
  ): void {
    if (!this.filterByPreviousResult) {
      return;
    }

    this.previousResult = result;
    this.previousCriteria = resolvedCriteria;
    this.previousBaseData = usesStoredData ? this.dataset : baseData;
  }

  private getCriteriaTransition(
    previousCriteria: ResolvedFilterCriterion<T>[],
    nextCriteria: ResolvedFilterCriterion<T>[],
  ): "unchanged" | "narrowed" | "expanded" {
    const previousByField = this.createCriteriaStateMap(previousCriteria);
    const nextByField = this.createCriteriaStateMap(nextCriteria);
    let hasNarrowing = false;

    for (const [field, previousCriterion] of previousByField) {
      const nextCriterion = nextByField.get(field);
      if (!nextCriterion) {
        return "expanded";
      }

      const comparison = this.compareCriteria(previousCriterion, nextCriterion);
      if (comparison === "expanded") {
        return "expanded";
      }

      if (comparison === "narrowed") {
        hasNarrowing = true;
      }
    }

    for (const field of nextByField.keys()) {
      if (!previousByField.has(field)) {
        hasNarrowing = true;
      }
    }

    return hasNarrowing ? "narrowed" : "unchanged";
  }

  private createCriteriaStateMap(
    criteria: ResolvedFilterCriterion<T>[],
  ): Map<string, ResolvedFilterCriterion<T>> {
    return new Map(criteria.map((criterion) => [criterion.field, criterion]));
  }

  private compareCriteria(
    previousCriterion: ResolvedFilterCriterion<T>,
    nextCriterion: ResolvedFilterCriterion<T>,
  ): "unchanged" | "narrowed" | "expanded" {
    let hasNarrowing = false;

    if (previousCriterion.hasValues || nextCriterion.hasValues) {
      if (previousCriterion.hasValues && !nextCriterion.hasValues) {
        return "expanded";
      }

      if (!previousCriterion.hasValues && nextCriterion.hasValues) {
        if (
          previousCriterion.hasExclude &&
          this.hasIntersection(
            nextCriterion.includedValues!,
            previousCriterion.excludedValues!,
          )
        ) {
          return "expanded";
        }

        hasNarrowing = true;
      } else if (
        previousCriterion.hasValues &&
        nextCriterion.hasValues &&
        !this.isSubset(
          nextCriterion.includedValues!,
          previousCriterion.includedValues!,
        )
      ) {
        return "expanded";
      } else if (
        previousCriterion.hasValues &&
        nextCriterion.hasValues &&
        !this.areSetsEqual(
          nextCriterion.includedValues!,
          previousCriterion.includedValues!,
        )
      ) {
        hasNarrowing = true;
      }
    }

    if (!previousCriterion.hasValues && !nextCriterion.hasValues) {
      if (previousCriterion.hasExclude && !nextCriterion.hasExclude) {
        return "expanded";
      }

      if (!previousCriterion.hasExclude && nextCriterion.hasExclude) {
        hasNarrowing = true;
      } else if (
        previousCriterion.hasExclude &&
        nextCriterion.hasExclude &&
        !this.isSubset(
          previousCriterion.excludedValues!,
          nextCriterion.excludedValues!,
        )
      ) {
        return "expanded";
      } else if (
        previousCriterion.hasExclude &&
        nextCriterion.hasExclude &&
        !this.areSetsEqual(
          previousCriterion.excludedValues!,
          nextCriterion.excludedValues!,
        )
      ) {
        hasNarrowing = true;
      }
    }

    return hasNarrowing ? "narrowed" : "unchanged";
  }

  private isSubset(values: Set<any>, allowedValues: Set<any>): boolean {
    for (const value of values) {
      if (!allowedValues.has(value)) {
        return false;
      }
    }

    return true;
  }

  private areSetsEqual(leftValues: Set<any>, rightValues: Set<any>): boolean {
    return (
      leftValues.size === rightValues.size &&
      this.isSubset(leftValues, rightValues)
    );
  }

  private hasIntersection(
    leftValues: Set<any>,
    rightValues: Set<any>,
  ): boolean {
    for (const value of leftValues) {
      if (rightValues.has(value)) {
        return true;
      }
    }

    return false;
  }
}
