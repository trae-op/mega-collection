/**
 * FilterEngine class for filtering collections by multiple criteria,
 * supporting indexed lookups and linear scans for large datasets.
 */

import { CollectionItem, FilterCriterion } from "../types";
import { Indexer } from "../indexer";
import { FilterEngineChain, FilterEngineChainBuilder } from "./chain";
import type { FilterEngineOptions } from "./types";
import { FilterEngineError } from "./errors";
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

  private readonly previousResultsByCriteria = new Map<string, T[]>();

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
    this.previousResultsByCriteria.clear();
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
        this.rawFilter(dataOrCriteria as FilterCriterion<T>[]),
      );
    }

    return this.withChain(this.rawFilter(dataOrCriteria as T[], criteria));
  }

  rawFilter(criteria: FilterCriterion<T>[]): T[];
  rawFilter(data: T[], criteria: FilterCriterion<T>[]): T[];
  rawFilter(
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
        const nextCriteriaKey = this.createCriteriaCacheKey(resolvedCriteria);
        const previousCriteriaKey = this.createCriteriaCacheKey(
          this.previousCriteria,
        );
        const cachedResult =
          this.previousResultsByCriteria.get(nextCriteriaKey);

        if (nextCriteriaKey === previousCriteriaKey) {
          return this.previousResult;
        }

        if (cachedResult !== undefined) {
          this.storePreviousResult(
            cachedResult,
            true,
            this.dataset,
            resolvedCriteria,
          );
          return cachedResult;
        }

        const shouldRecalculateFromDataset =
          this.hasCriteriaBacktrack(this.previousCriteria, resolvedCriteria) ||
          (this.previousResult.length === 0 &&
            !this.canApplySequentiallyToEmptyResult(
              this.previousCriteria,
              resolvedCriteria,
            ));

        sourceData = shouldRecalculateFromDataset
          ? this.dataset
          : this.previousResult;
        executionCriteria = shouldRecalculateFromDataset
          ? resolvedCriteria
          : this.createSequentialExecutionCriteria(
              this.previousCriteria,
              resolvedCriteria,
            );
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
        const nextCriteriaKey = this.createCriteriaCacheKey(resolvedCriteria);
        const previousCriteriaKey = this.createCriteriaCacheKey(
          this.previousCriteria,
        );
        const cachedResult =
          this.previousResultsByCriteria.get(nextCriteriaKey);

        if (nextCriteriaKey === previousCriteriaKey) {
          return this.previousResult;
        }

        if (cachedResult !== undefined) {
          this.storePreviousResult(
            cachedResult,
            false,
            dataOrCriteria as T[],
            resolvedCriteria,
          );
          return cachedResult;
        }

        const shouldRecalculateFromDataset =
          this.hasCriteriaBacktrack(this.previousCriteria, resolvedCriteria) ||
          (this.previousResult.length === 0 &&
            !this.canApplySequentiallyToEmptyResult(
              this.previousCriteria,
              resolvedCriteria,
            ));

        sourceData = shouldRecalculateFromDataset
          ? (dataOrCriteria as T[])
          : this.previousResult;
        executionCriteria = shouldRecalculateFromDataset
          ? resolvedCriteria
          : this.createSequentialExecutionCriteria(
              this.previousCriteria,
              resolvedCriteria,
            );
      } else {
        executionCriteria = resolvedCriteria;
      }
    }

    if (resolvedCriteria.length === 0) {
      if (this.filterByPreviousResult) {
        this.resetFilterState();
      }
      return usesStoredData ? this.dataset : (dataOrCriteria as T[]);
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
    this.previousResultsByCriteria.set(
      this.createCriteriaCacheKey(resolvedCriteria),
      result,
    );
  }

  private createCriteriaCacheKey(
    criteria: ResolvedFilterCriterion<T>[],
  ): string {
    const criteriaByField = this.createCriteriaStateMap(criteria);

    return JSON.stringify(
      [...criteriaByField.entries()]
        .sort(([leftField], [rightField]) =>
          leftField.localeCompare(rightField),
        )
        .map(([field, criterion]) => ({
          field,
          hasValues: criterion.hasValues,
          hasExclude: criterion.hasExclude,
          values: criterion.values.map((value) => JSON.stringify(value)).sort(),
          exclude: criterion.exclude
            .map((value) => JSON.stringify(value))
            .sort(),
        })),
    );
  }

  private createSequentialExecutionCriteria(
    previousCriteria: ResolvedFilterCriterion<T>[],
    nextCriteria: ResolvedFilterCriterion<T>[],
  ): ResolvedFilterCriterion<T>[] {
    const previousByField = new Map<string, ResolvedFilterCriterion<T>>();

    for (
      let criterionIndex = 0;
      criterionIndex < previousCriteria.length;
      criterionIndex++
    ) {
      const criterion = previousCriteria[criterionIndex];
      previousByField.set(criterion.field, criterion);
    }

    return nextCriteria.map((criterion) => {
      const previousCriterion = previousByField.get(criterion.field);

      if (
        !previousCriterion ||
        !previousCriterion.hasValues ||
        !criterion.hasValues ||
        previousCriterion.hasExclude ||
        criterion.hasExclude
      ) {
        return criterion;
      }

      if (
        criterion.includedValues!.size <= previousCriterion.includedValues!.size
      ) {
        return criterion;
      }

      for (const value of previousCriterion.includedValues!) {
        if (!criterion.includedValues!.has(value)) {
          return criterion;
        }
      }

      const appendedValues: any[] = [];

      for (const value of criterion.includedValues!) {
        if (!previousCriterion.includedValues!.has(value)) {
          appendedValues.push(value);
        }
      }

      if (appendedValues.length === 0) {
        return criterion;
      }

      return {
        ...criterion,
        values: appendedValues,
        includedValues: new Set(appendedValues),
      };
    });
  }

  private hasCriteriaBacktrack(
    previousCriteria: ResolvedFilterCriterion<T>[],
    nextCriteria: ResolvedFilterCriterion<T>[],
  ): boolean {
    const previousByField = this.createCriteriaStateMap(previousCriteria);
    const nextByField = this.createCriteriaStateMap(nextCriteria);

    for (const [field, previousCriterion] of previousByField) {
      const nextCriterion = nextByField.get(field);

      if (!nextCriterion) {
        return true;
      }

      if (this.isCriterionBacktracked(previousCriterion, nextCriterion)) {
        return true;
      }
    }

    return false;
  }

  private canApplySequentiallyToEmptyResult(
    previousCriteria: ResolvedFilterCriterion<T>[],
    nextCriteria: ResolvedFilterCriterion<T>[],
  ): boolean {
    const previousByField = this.createCriteriaStateMap(previousCriteria);
    const nextByField = this.createCriteriaStateMap(nextCriteria);

    for (const [field, nextCriterion] of nextByField) {
      const previousCriterion = previousByField.get(field);

      if (!previousCriterion) {
        continue;
      }

      if (previousCriterion.hasValues !== nextCriterion.hasValues) {
        if (previousCriterion.hasValues || !nextCriterion.hasValues) {
          return false;
        }
      }

      if (previousCriterion.hasValues && nextCriterion.hasValues) {
        const previousValues = previousCriterion.includedValues!;
        const nextValues = nextCriterion.includedValues!;

        if (
          !this.areSetsEqual(previousValues, nextValues) &&
          !this.isSubset(previousValues, nextValues)
        ) {
          return false;
        }
      }

      if (previousCriterion.hasExclude !== nextCriterion.hasExclude) {
        if (previousCriterion.hasExclude || !nextCriterion.hasExclude) {
          return false;
        }
      }

      if (previousCriterion.hasExclude && nextCriterion.hasExclude) {
        const previousExcluded = previousCriterion.excludedValues!;
        const nextExcluded = nextCriterion.excludedValues!;

        if (
          !this.areSetsEqual(previousExcluded, nextExcluded) &&
          !this.isSubset(previousExcluded, nextExcluded)
        ) {
          return false;
        }
      }
    }

    return true;
  }

  private createCriteriaStateMap(
    criteria: ResolvedFilterCriterion<T>[],
  ): Map<string, ResolvedFilterCriterion<T>> {
    const criteriaByField = new Map<string, ResolvedFilterCriterion<T>>();

    for (
      let criterionIndex = 0;
      criterionIndex < criteria.length;
      criterionIndex++
    ) {
      const criterion = criteria[criterionIndex];
      const existingCriterion = criteriaByField.get(criterion.field);

      if (!existingCriterion) {
        criteriaByField.set(criterion.field, {
          ...criterion,
          values: criterion.values.slice(),
          exclude: criterion.exclude.slice(),
          includedValues: criterion.includedValues
            ? new Set(criterion.includedValues)
            : null,
          excludedValues: criterion.excludedValues
            ? new Set(criterion.excludedValues)
            : null,
        });
        continue;
      }

      if (criterion.hasValues) {
        if (!existingCriterion.hasValues) {
          existingCriterion.hasValues = true;
          existingCriterion.includedValues = new Set(criterion.includedValues!);
        } else {
          for (const value of existingCriterion.includedValues!) {
            if (!criterion.includedValues!.has(value)) {
              existingCriterion.includedValues!.delete(value);
            }
          }
        }
      }

      if (criterion.hasExclude) {
        if (!existingCriterion.hasExclude) {
          existingCriterion.hasExclude = true;
          existingCriterion.excludedValues = new Set(criterion.excludedValues!);
        } else {
          for (const value of criterion.excludedValues!) {
            existingCriterion.excludedValues!.add(value);
          }
        }
      }

      if (existingCriterion.hasValues && existingCriterion.hasExclude) {
        for (const value of existingCriterion.excludedValues!) {
          existingCriterion.includedValues!.delete(value);
        }
      }

      existingCriterion.values = existingCriterion.includedValues
        ? [...existingCriterion.includedValues]
        : [];
      existingCriterion.exclude = existingCriterion.excludedValues
        ? [...existingCriterion.excludedValues]
        : [];
    }

    return criteriaByField;
  }

  private isCriterionBacktracked(
    previousCriterion: ResolvedFilterCriterion<T>,
    nextCriterion: ResolvedFilterCriterion<T>,
  ): boolean {
    if (previousCriterion.hasValues && !nextCriterion.hasValues) {
      return true;
    }

    if (previousCriterion.hasValues && nextCriterion.hasValues) {
      const previousValues = previousCriterion.includedValues!;
      const nextValues = nextCriterion.includedValues!;

      if (!this.areSetsEqual(previousValues, nextValues)) {
        return this.isSubset(nextValues, previousValues);
      }
    }

    if (!previousCriterion.hasValues && nextCriterion.hasValues) {
      return false;
    }

    if (previousCriterion.hasExclude && !nextCriterion.hasExclude) {
      return true;
    }

    if (!previousCriterion.hasExclude && nextCriterion.hasExclude) {
      return false;
    }

    if (previousCriterion.hasExclude && nextCriterion.hasExclude) {
      const previousExcluded = previousCriterion.excludedValues!;
      const nextExcluded = nextCriterion.excludedValues!;

      if (!this.areSetsEqual(previousExcluded, nextExcluded)) {
        return this.isSubset(nextExcluded, previousExcluded);
      }
    }

    return false;
  }

  private isSubset(values: Set<any>, allowedValues: Set<any>): boolean {
    for (const value of values) {
      if (!allowedValues.has(value)) {
        return false;
      }
    }

    return true;
  }

  private areSetsEqual(
    leftValues: Set<any> | null,
    rightValues: Set<any> | null,
  ): boolean {
    if (leftValues === rightValues) {
      return true;
    }

    if (!leftValues || !rightValues || leftValues.size !== rightValues.size) {
      return false;
    }

    for (const value of leftValues) {
      if (!rightValues.has(value)) {
        return false;
      }
    }

    return true;
  }
}
