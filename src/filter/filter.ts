/**
 * FilterEngine class for filtering collections by multiple criteria,
 * supporting indexed lookups and linear scans for large datasets.
 */

import { State } from "../State";
import {
  CollectionItem,
  FilterCriterion,
  type IndexableKey,
  type StateMutation,
  type UpdateDescriptor,
} from "../types";
import { Indexer } from "../indexer";
import { FilterEngineChain, FilterEngineChainBuilder } from "./chain";
import type {
  FilterEngineOptions,
  FilterRuntime,
  FilterSequentialCache,
  MutableExcludeRuntime,
  ResolvedFilterCriterion,
} from "./types";
import { FilterEngineError } from "./errors";
import {
  isCriterionUnsatisfiable,
  matchesCriterionValue,
  resolveCriteria,
} from "./criterion";
import { FilterNestedCollection } from "./nested";

const createFilterRuntime = <T extends CollectionItem>(): FilterRuntime<T> => ({
  indexedFields: new Set<keyof T & string>(),
  indexerStorage: {
    indexes: new Map<string, Map<any, T[]>>(),
    itemPositions: new Map<string, Map<any, WeakMap<T, number>>>(),
  },
  nestedStorage: {
    indexes: new Map<string, Map<any, T[]>>(),
    itemPositions: new Map<string, Map<any, WeakMap<T, number>>>(),
  },
  mutableExclude: {
    datasetPositions: new Map<any, number>(),
    valueCounts: new Map<any, number>(),
    duplicateValueCount: 0,
    hasDuplicateValues: false,
  },
  sequentialCache: {
    previousResult: null,
    previousCriteria: null,
    previousBaseData: null,
    previousResultsByCriteria: new Map<string, T[]>(),
    previousResultSet: null,
  },
});

export class FilterEngine<T extends CollectionItem> {
  private readonly indexer: Indexer<T>;
  private readonly filterByPreviousResult: boolean;

  private readonly mutableExcludeField: (keyof T & string) | null;

  private readonly state: State<T>;

  private readonly namespace: string;

  private readonly nestedCollection: FilterNestedCollection<T>;

  private readonly chainBuilder = new FilterEngineChainBuilder<T>({
    filter: (dataOrCriteria, criteria) => {
      if (criteria === undefined) {
        return this.filter(dataOrCriteria as FilterCriterion<T>[]);
      }

      return this.filter(dataOrCriteria as T[], criteria);
    },
    getOriginData: () => this.getOriginData(),
    add: (items) => this.add(items),
    update: (descriptor) => this.update(descriptor),
    data: (data) => this.data(data),
    clearIndexes: () => this.clearIndexes(),
    clearData: () => this.clearData(),
    resetFilterState: () => this.resetFilterState(),
  });

  /**
   * Creates a new FilterEngine with optional data and fields to index.
   */
  constructor(options: FilterEngineOptions<T> & { state?: State<T> } = {}) {
    this.mutableExcludeField = options.mutableExcludeField ?? null;
    this.state =
      options.state ??
      new State(options.data ?? [], {
        filterByPreviousResult: options.filterByPreviousResult ?? false,
      });

    if (options.filterByPreviousResult) {
      this.state.setFilterByPreviousResult(true);
    }

    this.filterByPreviousResult = this.state.isFilterByPreviousResultEnabled();
    this.namespace = this.state.createNamespace("filter");
    this.indexer = new Indexer<T>(this.runtime.indexerStorage);
    this.nestedCollection = new FilterNestedCollection<T>(
      this.runtime.nestedStorage,
    );
    this.nestedCollection.registerFields(options.nestedFields);
    this.state.subscribe((mutation) => this.handleStateMutation(mutation));
    this.rebuildMutableExcludeState();

    const hasFields = options.fields?.length;
    const hasNestedFields = this.nestedCollection.hasRegisteredFields();

    if (hasFields) {
      for (const field of options.fields!) {
        this.indexedFields.add(field);
      }
    }

    if (this.dataset.length > 0 && (hasFields || hasNestedFields)) {
      this.rebuildConfiguredIndexes();
    }
  }

  private get dataset(): T[] {
    return this.state.getOriginData();
  }

  private get runtime(): FilterRuntime<T> {
    return this.state.getOrCreateScopedValue<FilterRuntime<T>>(
      this.namespace,
      "runtime",
      createFilterRuntime,
    );
  }

  private get mutableExcludeState(): MutableExcludeRuntime {
    return this.runtime.mutableExclude;
  }

  private get indexedFields(): Set<keyof T & string> {
    return this.runtime.indexedFields;
  }

  private get sequentialCache(): FilterSequentialCache<T> {
    return this.runtime.sequentialCache;
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
    this.sequentialCache.previousResult = null;
    this.sequentialCache.previousCriteria = null;
    this.sequentialCache.previousBaseData = null;
    this.sequentialCache.previousResultsByCriteria.clear();
    this.sequentialCache.previousResultSet = null;
    this.state.clearPreviousResult();
    return this;
  }

  clearData(): this {
    this.state.clearData();
    return this;
  }

  data(data: T[]): this {
    this.state.data(data);
    return this;
  }

  add(items: T[]): this {
    this.state.add(items);
    return this;
  }

  update(descriptor: UpdateDescriptor<T>): this {
    this.state.update(descriptor);
    return this;
  }

  private applyAddedItems(items: T[], shouldAppendToDataset: boolean): this {
    if (items.length === 0) {
      return this;
    }

    if (shouldAppendToDataset) {
      this.state.add(items);
      return this;
    }

    const startIndex = this.dataset.length - items.length;

    this.updateMutableExcludeStateForAddedItems(items, startIndex);
    this.resetFilterState();
    this.indexer.addItems(items);
    this.nestedCollection.addItems(items);
    return this;
  }

  getOriginData(): T[] {
    return this.state.getOriginData();
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
    const isUsingStoredData = criteria === undefined;

    if (isUsingStoredData && !this.dataset.length) {
      throw FilterEngineError.missingDatasetForFilter();
    }

    const resolvedCriteria = resolveCriteria(
      isUsingStoredData ? (dataOrCriteria as FilterCriterion<T>[]) : criteria!,
    );

    const baseData: T[] = isUsingStoredData
      ? this.dataset
      : (dataOrCriteria as T[]);

    if (isUsingStoredData) {
      const mutableExcludeResult = this.applyMutableExclude(resolvedCriteria);
      if (mutableExcludeResult !== undefined) {
        return mutableExcludeResult;
      }
    }

    let sourceData = baseData;
    let executionCriteria = resolvedCriteria;

    if (this.filterByPreviousResult) {
      const cached = this.resolveWithSequentialCache(
        baseData,
        isUsingStoredData,
        resolvedCriteria,
      );

      if (cached.isFromCache) {
        return cached.result;
      }

      sourceData = cached.sourceData;
      executionCriteria = cached.executionCriteria;
    }

    if (resolvedCriteria.length === 0) {
      if (this.filterByPreviousResult) {
        this.resetFilterState();
      }
      return baseData;
    }

    for (
      let criterionIndex = 0;
      criterionIndex < executionCriteria.length;
      criterionIndex++
    ) {
      if (isCriterionUnsatisfiable(executionCriteria[criterionIndex])) {
        return this.createEmptyResult(
          isUsingStoredData,
          baseData,
          resolvedCriteria,
        );
      }
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
          isUsingStoredData,
          baseData,
          resolvedCriteria,
        );
      }
    }

    if (flatCriteria.length === 0) {
      this.storePreviousResult(
        sourceData,
        isUsingStoredData,
        baseData,
        resolvedCriteria,
      );
      return sourceData;
    }

    const indexedCriteria: ResolvedFilterCriterion<T>[] = [];
    const linearCriteria: ResolvedFilterCriterion<T>[] = [];

    for (
      let criterionIndex = 0;
      criterionIndex < flatCriteria.length;
      criterionIndex++
    ) {
      const criterion = flatCriteria[criterionIndex];
      if (this.indexer.hasIndex(criterion.field)) {
        indexedCriteria.push(criterion);
      } else {
        linearCriteria.push(criterion);
      }
    }

    let result: T[];

    if (indexedCriteria.length > 0 && linearCriteria.length === 0) {
      result = this.filterViaIndex(indexedCriteria, sourceData);
      this.storePreviousResult(
        result,
        isUsingStoredData,
        baseData,
        resolvedCriteria,
      );
      return result;
    }

    if (indexedCriteria.length > 0 && linearCriteria.length > 0) {
      const candidates = this.filterViaIndex(indexedCriteria, sourceData);
      result = this.linearFilter(candidates, linearCriteria);
      this.storePreviousResult(
        result,
        isUsingStoredData,
        baseData,
        resolvedCriteria,
      );
      return result;
    }

    result = this.linearFilter(sourceData, flatCriteria);
    this.storePreviousResult(
      result,
      isUsingStoredData,
      baseData,
      resolvedCriteria,
    );
    return result;
  }

  private resolveWithSequentialCache(
    baseData: T[],
    isUsingStoredData: boolean,
    resolvedCriteria: ResolvedFilterCriterion<T>[],
  ):
    | { isFromCache: true; result: T[] }
    | {
        isFromCache: false;
        sourceData: T[];
        executionCriteria: ResolvedFilterCriterion<T>[];
      } {
    const {
      previousResult,
      previousCriteria,
      previousBaseData,
      previousResultsByCriteria,
    } = this.sequentialCache;

    if (
      previousResult === null ||
      previousCriteria === null ||
      previousBaseData !== baseData
    ) {
      return {
        isFromCache: false,
        sourceData: baseData,
        executionCriteria: resolvedCriteria,
      };
    }

    const nextCriteriaKey = this.createCriteriaCacheKey(resolvedCriteria);
    const previousCriteriaKey = this.createCriteriaCacheKey(previousCriteria);
    const cachedResult = previousResultsByCriteria.get(nextCriteriaKey);

    if (nextCriteriaKey === previousCriteriaKey) {
      return { isFromCache: true, result: previousResult };
    }

    if (cachedResult !== undefined) {
      this.storePreviousResult(
        cachedResult,
        isUsingStoredData,
        baseData,
        resolvedCriteria,
      );
      return { isFromCache: true, result: cachedResult };
    }

    const shouldRecalculate =
      this.hasCriteriaBacktrack(previousCriteria, resolvedCriteria) ||
      (previousResult.length === 0 &&
        !this.canApplySequentiallyToEmptyResult(
          previousCriteria,
          resolvedCriteria,
        ));

    return {
      isFromCache: false,
      sourceData: shouldRecalculate ? baseData : previousResult,
      executionCriteria: shouldRecalculate
        ? resolvedCriteria
        : this.createSequentialExecutionCriteria(
            previousCriteria,
            resolvedCriteria,
          ),
    };
  }

  private withChain(result: T[]): T[] & FilterEngineChain<T> {
    return this.chainBuilder.create(result);
  }

  private handleStateMutation(mutation: StateMutation<T>): void {
    switch (mutation.type) {
      case "add":
        this.applyAddedItems(mutation.items, false);
        return;
      case "update":
        this.applyUpdatedItem(
          mutation.index,
          mutation.previousItem,
          mutation.nextItem,
        );
        return;
      case "data":
        this.rebuildMutableExcludeState();
        this.resetFilterState();
        this.rebuildConfiguredIndexes();
        return;
      case "clearData":
        this.clearMutableExcludeState();
        this.indexer.clear();
        this.nestedCollection.clearIndexes();
        this.resetFilterState();
        return;
      case "remove":
        this.applyRemovedItem(
          mutation.field,
          mutation.value,
          mutation.removedItem,
          mutation.removedIndex,
          mutation.movedItem,
        );
        return;
    }
  }

  private rebuildMutableExcludeState(): void {
    this.clearMutableExcludeState();

    if (this.mutableExcludeField === null) {
      return;
    }

    for (let itemIndex = 0; itemIndex < this.dataset.length; itemIndex++) {
      const item = this.dataset[itemIndex];
      const fieldValue = item[this.mutableExcludeField];

      if (fieldValue === undefined || fieldValue === null) {
        continue;
      }

      this.registerMutableExcludeValue(fieldValue, itemIndex);
    }
  }

  private updateMutableExcludeStateForAddedItems(
    items: T[],
    startIndex: number,
  ): void {
    if (this.mutableExcludeField === null) {
      return;
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const fieldValue = items[itemIndex][this.mutableExcludeField];

      if (fieldValue === undefined || fieldValue === null) {
        continue;
      }

      this.registerMutableExcludeValue(fieldValue, startIndex + itemIndex);
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

    if (this.mutableExcludeState.hasDuplicateValues) {
      throw FilterEngineError.duplicateMutableExcludeField(
        this.mutableExcludeField,
      );
    }

    for (
      let valueIndex = 0;
      valueIndex < criterion.exclude.length;
      valueIndex++
    ) {
      this.state.removeByFieldValue(
        this.mutableExcludeField as IndexableKey<T> & string,
        criterion.exclude[valueIndex],
      );
    }

    this.resetFilterState();
    return this.dataset;
  }

  private applyUpdatedItem(index: number, previousItem: T, nextItem: T): void {
    this.updateMutableExcludeStateForUpdatedItem(index, previousItem, nextItem);
    this.resetFilterState();
    this.indexer.removeItem(previousItem);
    this.indexer.addItem(nextItem);
    this.nestedCollection.updateItem(nextItem, previousItem);
  }

  private applyRemovedItem(
    field: IndexableKey<T> & string,
    value: T[IndexableKey<T> & string],
    removedItem: T,
    removedIndex: number,
    movedItem: T | null,
  ): void {
    if (field === this.mutableExcludeField) {
      this.unregisterMutableExcludeValue(value);
      this.mutableExcludeState.datasetPositions.delete(value);

      if (movedItem !== null && this.mutableExcludeField !== null) {
        const movedValue = movedItem[this.mutableExcludeField];

        if (movedValue !== undefined && movedValue !== null) {
          this.mutableExcludeState.datasetPositions.set(
            movedValue,
            removedIndex,
          );
        }
      }
    }

    this.resetFilterState();
    this.indexer.removeItem(removedItem);
    this.nestedCollection.removeItem(removedItem);
  }

  private updateMutableExcludeStateForUpdatedItem(
    itemIndex: number,
    previousItem: T,
    nextItem: T,
  ): void {
    if (this.mutableExcludeField === null) {
      return;
    }

    const previousFieldValue = previousItem[this.mutableExcludeField];
    const nextFieldValue = nextItem[this.mutableExcludeField];

    if (previousFieldValue === nextFieldValue) {
      if (nextFieldValue !== undefined && nextFieldValue !== null) {
        this.mutableExcludeState.datasetPositions.set(
          nextFieldValue,
          itemIndex,
        );
      }

      return;
    }

    if (previousFieldValue !== undefined && previousFieldValue !== null) {
      this.unregisterMutableExcludeValue(previousFieldValue);

      if (
        this.mutableExcludeState.datasetPositions.get(previousFieldValue) ===
        itemIndex
      ) {
        this.mutableExcludeState.datasetPositions.delete(previousFieldValue);
      }
    }

    if (nextFieldValue !== undefined && nextFieldValue !== null) {
      this.registerMutableExcludeValue(nextFieldValue, itemIndex);
    }
  }

  private clearMutableExcludeState(): void {
    this.mutableExcludeState.datasetPositions.clear();
    this.mutableExcludeState.valueCounts.clear();
    this.mutableExcludeState.duplicateValueCount = 0;
    this.mutableExcludeState.hasDuplicateValues = false;
  }

  private registerMutableExcludeValue(
    fieldValue: any,
    itemIndex: number,
  ): void {
    const nextCount =
      (this.mutableExcludeState.valueCounts.get(fieldValue) ?? 0) + 1;

    if (nextCount === 2) {
      this.mutableExcludeState.duplicateValueCount++;
    }

    this.mutableExcludeState.valueCounts.set(fieldValue, nextCount);
    this.mutableExcludeState.datasetPositions.set(fieldValue, itemIndex);
    this.mutableExcludeState.hasDuplicateValues =
      this.mutableExcludeState.duplicateValueCount > 0;
  }

  private unregisterMutableExcludeValue(fieldValue: any): void {
    const currentCount = this.mutableExcludeState.valueCounts.get(fieldValue);

    if (currentCount === undefined) {
      return;
    }

    if (currentCount === 2) {
      this.mutableExcludeState.duplicateValueCount--;
    }

    if (currentCount <= 1) {
      this.mutableExcludeState.valueCounts.delete(fieldValue);
    } else {
      this.mutableExcludeState.valueCounts.set(fieldValue, currentCount - 1);
    }

    this.mutableExcludeState.hasDuplicateValues =
      this.mutableExcludeState.duplicateValueCount > 0;
  }

  /**
   * Filters data linearly without index.
   */
  private linearFilter(data: T[], criteria: ResolvedFilterCriterion<T>[]): T[] {
    const result: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      let isMatchingAll = true;

      for (
        let criterionIndex = 0;
        criterionIndex < criteria.length;
        criterionIndex++
      ) {
        const criterion = criteria[criterionIndex];
        if (!matchesCriterionValue(criterion, item[criterion.field])) {
          isMatchingAll = false;
          break;
        }
      }

      if (isMatchingAll) {
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
    let allowedItems: Set<T> | null = null;
    if (isFilteringFromSubset) {
      // Reuse the cached Set when sourceData is the stored previous result,
      // avoiding an O(m) Set construction on every narrowing call.
      if (
        sourceData === this.sequentialCache.previousResult &&
        this.sequentialCache.previousResultSet !== null
      ) {
        allowedItems = this.sequentialCache.previousResultSet;
      } else {
        allowedItems = new Set(sourceData);
      }
    }
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
      let isMatchingAll = true;

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
          isMatchingAll = false;
          break;
        }
      }

      if (isMatchingAll) {
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
    isUsingStoredData: boolean,
    baseData: T[],
    resolvedCriteria: ResolvedFilterCriterion<T>[],
  ): T[] {
    const emptyResult: T[] = [];
    this.storePreviousResult(
      emptyResult,
      isUsingStoredData,
      baseData,
      resolvedCriteria,
    );
    return emptyResult;
  }

  private storePreviousResult(
    result: T[],
    isUsingStoredData: boolean,
    baseData: T[],
    resolvedCriteria: ResolvedFilterCriterion<T>[],
  ): void {
    if (!this.filterByPreviousResult) {
      return;
    }

    this.sequentialCache.previousResult = result;
    this.sequentialCache.previousCriteria = resolvedCriteria;
    this.sequentialCache.previousBaseData = isUsingStoredData
      ? this.dataset
      : baseData;
    this.sequentialCache.previousResultSet =
      result.length > 0 ? new Set(result) : null;
    this.state.setPreviousResult(
      result,
      isUsingStoredData ? this.dataset : baseData,
    );
    this.sequentialCache.previousResultsByCriteria.set(
      this.createCriteriaCacheKey(resolvedCriteria),
      result,
    );
  }

  private createCriteriaCacheKey(
    criteria: ResolvedFilterCriterion<T>[],
  ): string {
    // Sort criteria by field name so key is order-independent.
    const sorted = criteria
      .slice()
      .sort((a, b) => ((a.field as string) < (b.field as string) ? -1 : 1));

    let key = "";
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      // Segment format: "<field>|v:<v1>,<v2>|x:<x1>,<x2>;"
      // String() handles boolean/number/string values correctly.
      // Objects that appear as filter values are rare in practice; keep
      // JSON.stringify only for them to preserve unambiguous encoding.
      key += c.field as string;
      key += "|v:";
      if (c.hasValues) {
        key += c.values
          .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
          .sort()
          .join(",");
      }
      key += "|x:";
      if (c.hasExclude) {
        key += c.exclude
          .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
          .sort()
          .join(",");
      }
      key += ";";
    }
    return key;
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
