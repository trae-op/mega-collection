/**
 * SortEngine class for sorting large datasets using pre-built indexes
 * for O(n) performance or fallback to in-place sorting.
 */

import { CollectionItem, SortDescriptor, SortDirection } from "../types";
import type { SortEngineOptions, SortIndex } from "./types";
import { SortEngineError } from "./errors";

export class SortEngine<T extends CollectionItem> {
  private cache = new Map<string, SortIndex<T>>();

  private dataset: T[] = [];

  private readonly indexedFields = new Set<keyof T & string>();

  private readonly dirtyIndexedFields = new Set<keyof T & string>();

  /**
   * Creates a new SortEngine with optional data and fields to index.
   */
  constructor(options: SortEngineOptions<T> = {}) {
    if (!options.data) return;

    this.dataset = options.data;
    if (options.fields?.length) {
      for (const field of options.fields) {
        this.indexedFields.add(field);
      }

      this.rebuildConfiguredIndexes();
    }
  }

  private rebuildConfiguredIndexes(): void {
    this.cache.clear();

    for (const field of this.indexedFields) {
      this.buildIndex(this.dataset, field);
    }
  }

  /**
   * Builds an index for sorting the given field.
   */
  private buildIndex(data: T[], field: keyof T & string): this;
  private buildIndex(field: keyof T & string): this;
  private buildIndex(
    dataOrField: T[] | (keyof T & string),
    field?: keyof T & string,
  ): this {
    let data: T[];
    let resolvedField: keyof T & string;

    if (!Array.isArray(dataOrField)) {
      if (!this.dataset.length) {
        throw SortEngineError.missingDatasetForBuildIndex();
      }

      data = this.dataset;
      resolvedField = dataOrField;
    } else {
      data = dataOrField;
      resolvedField = field!;
    }

    this.dataset = data;
    const itemCount = data.length;
    const indexes = new Uint32Array(itemCount);
    const fieldValues = new Array<unknown>(itemCount);

    for (let index = 0; index < itemCount; index++) {
      indexes[index] = index;
      fieldValues[index] = data[index][resolvedField];
    }

    const firstValue = fieldValues[0];

    if (typeof firstValue === "number") {
      const numericValues = new Float64Array(itemCount);
      for (let i = 0; i < itemCount; i++)
        numericValues[i] = fieldValues[i] as number;
      indexes.sort((a, b) => numericValues[a] - numericValues[b]);
    } else {
      indexes.sort((a, b) => {
        const av = fieldValues[a] as string;
        const bv = fieldValues[b] as string;
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
    }

    this.cache.set(resolvedField as string, {
      indexes,
      dataRef: data,
      itemCount,
    });
    this.dirtyIndexedFields.delete(resolvedField);
    return this;
  }

  /**
   * Clears all cached indexes.
   */
  clearIndexes(): this {
    this.cache.clear();
    this.dirtyIndexedFields.clear();
    return this;
  }

  clearData(): this {
    this.dataset = [];
    this.cache.clear();
    this.dirtyIndexedFields.clear();
    return this;
  }

  data(data: T[]): this {
    this.dataset = data;
    this.dirtyIndexedFields.clear();
    this.rebuildConfiguredIndexes();
    return this;
  }

  add(items: T[]): this {
    return this.applyAddedItems(items, true);
  }

  private applyAddedItems(items: T[], appendToDataset: boolean): this {
    if (items.length === 0) {
      return this;
    }

    const startIndex = appendToDataset
      ? this.dataset.length
      : this.dataset.length - items.length;

    if (appendToDataset) {
      this.dataset.push(...items);
    }

    for (const field of this.indexedFields) {
      const cachedIndex = this.cache.get(field as string);

      if (!cachedIndex) {
        continue;
      }

      if (
        this.dirtyIndexedFields.has(field) ||
        cachedIndex.dataRef !== this.dataset ||
        cachedIndex.itemCount !== startIndex
      ) {
        this.dirtyIndexedFields.add(field);
        continue;
      }

      this.updateCachedIndexForAddedItems(field, startIndex, items.length);
    }

    return this;
  }

  getOriginData(): T[] {
    return this.dataset;
  }

  /**
   * Sorts the data based on the given descriptors.
   */
  sort(descriptors: SortDescriptor<T>[]): T[];
  sort(data: T[], descriptors: SortDescriptor<T>[], inPlace?: boolean): T[];
  sort(
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace = false,
  ): T[] {
    let data: T[];
    let resolvedDescriptors: SortDescriptor<T>[];
    const usesStoredDataset = descriptors === undefined;

    if (descriptors === undefined) {
      if (!this.dataset.length) {
        throw SortEngineError.missingDatasetForSort();
      }

      data = this.dataset;
      resolvedDescriptors = dataOrDescriptors as SortDescriptor<T>[];
    } else {
      data = dataOrDescriptors as T[];
      resolvedDescriptors = descriptors;
    }

    if (resolvedDescriptors.length === 0 || data.length === 0) {
      return data;
    }

    if (resolvedDescriptors.length === 1) {
      const { field, direction } = resolvedDescriptors[0];
      if (
        usesStoredDataset &&
        this.dirtyIndexedFields.has(field) &&
        this.cache.has(field as string)
      ) {
        this.buildIndex(field);
      }

      const cached = this.cache.get(field as string);

      if (
        usesStoredDataset &&
        cached?.dataRef === data &&
        cached.itemCount === data.length
      ) {
        return this.reconstructFromIndex(data, cached.indexes, direction);
      }
    }

    const sortableItems = inPlace ? data : data.slice();

    if (
      resolvedDescriptors.length === 1 &&
      data.length > 0 &&
      typeof data[0][resolvedDescriptors[0].field] === "number"
    ) {
      return this.radixSortNumeric(
        sortableItems,
        resolvedDescriptors[0].field,
        resolvedDescriptors[0].direction,
      );
    }

    const comparator = this.buildComparator(resolvedDescriptors);
    sortableItems.sort(comparator);
    return sortableItems;
  }

  /**
   * Reconstructs the sorted array from the cached index.
   */
  private reconstructFromIndex(
    data: T[],
    indexes: Uint32Array,
    direction: SortDirection,
  ): T[] {
    const itemCount = data.length;
    const result: T[] = new Array(itemCount);

    if (direction === "asc") {
      for (let i = 0; i < itemCount; i++) result[i] = data[indexes[i]];
    } else {
      for (let i = 0; i < itemCount; i++)
        result[i] = data[indexes[itemCount - 1 - i]];
    }

    return result;
  }

  private updateCachedIndexForAddedItems(
    field: keyof T & string,
    startIndex: number,
    addedItemCount: number,
  ): void {
    const cachedIndex = this.cache.get(field as string);
    if (!cachedIndex) {
      return;
    }

    const appendedIndexes = this.buildSortedIndexesForRange(
      field,
      startIndex,
      addedItemCount,
    );

    this.cache.set(field as string, {
      indexes: this.mergeSortedIndexes(
        field,
        cachedIndex.indexes,
        appendedIndexes,
      ),
      dataRef: this.dataset,
      itemCount: startIndex + addedItemCount,
    });
    this.dirtyIndexedFields.delete(field);
  }

  private buildSortedIndexesForRange(
    field: keyof T & string,
    startIndex: number,
    itemCount: number,
  ): Uint32Array {
    const indexes = new Uint32Array(itemCount);

    for (let index = 0; index < itemCount; index++) {
      indexes[index] = startIndex + index;
    }

    indexes.sort((leftIndex, rightIndex) =>
      this.compareIndexesByField(field, leftIndex, rightIndex),
    );

    return indexes;
  }

  private mergeSortedIndexes(
    field: keyof T & string,
    existingIndexes: Uint32Array,
    appendedIndexes: Uint32Array,
  ): Uint32Array {
    const mergedIndexes = new Uint32Array(
      existingIndexes.length + appendedIndexes.length,
    );

    let existingIndex = 0;
    let appendedIndex = 0;
    let writeIndex = 0;

    while (
      existingIndex < existingIndexes.length &&
      appendedIndex < appendedIndexes.length
    ) {
      if (
        this.compareIndexesByField(
          field,
          existingIndexes[existingIndex],
          appendedIndexes[appendedIndex],
        ) <= 0
      ) {
        mergedIndexes[writeIndex++] = existingIndexes[existingIndex++];
        continue;
      }

      mergedIndexes[writeIndex++] = appendedIndexes[appendedIndex++];
    }

    while (existingIndex < existingIndexes.length) {
      mergedIndexes[writeIndex++] = existingIndexes[existingIndex++];
    }

    while (appendedIndex < appendedIndexes.length) {
      mergedIndexes[writeIndex++] = appendedIndexes[appendedIndex++];
    }

    return mergedIndexes;
  }

  private compareIndexesByField(
    field: keyof T & string,
    leftIndex: number,
    rightIndex: number,
  ): number {
    const leftValue = this.dataset[leftIndex]?.[field];
    const rightValue = this.dataset[rightIndex]?.[field];

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      const difference = leftValue - rightValue;
      if (difference !== 0) {
        return difference;
      }
    } else {
      if (leftValue < rightValue) {
        return -1;
      }

      if (leftValue > rightValue) {
        return 1;
      }
    }

    return leftIndex - rightIndex;
  }

  /**
   * Builds a comparator function for sorting.
   */
  private buildComparator(
    descriptors: SortDescriptor<T>[],
  ): (a: T, b: T) => number {
    const fields = descriptors.map(({ field }) => field);
    const directionMultipliers = descriptors.map(({ direction }) =>
      direction === "asc" ? 1 : -1,
    );

    const fieldCount = fields.length;

    return (a: T, b: T): number => {
      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        const leftValue = a[fields[fieldIndex]];
        const rightValue = b[fields[fieldIndex]];

        if (leftValue < rightValue) return -directionMultipliers[fieldIndex];
        if (leftValue > rightValue) return directionMultipliers[fieldIndex];
      }
      return 0;
    };
  }

  /**
   * Sorts numeric data using radix sort.
   */
  private radixSortNumeric(
    data: T[],
    field: string,
    direction: SortDirection,
  ): T[] {
    const itemCount = data.length;

    const values = new Float64Array(itemCount);
    for (let index = 0; index < itemCount; index++) {
      values[index] = data[index][field] as number;
    }

    const indexes = new Uint32Array(itemCount);
    for (let index = 0; index < itemCount; index++) indexes[index] = index;

    indexes.sort((a, b) => values[a] - values[b]);

    const result: T[] = new Array(itemCount);
    if (direction === "asc") {
      for (let index = 0; index < itemCount; index++) {
        result[index] = data[indexes[index]];
      }
    } else {
      for (let index = 0; index < itemCount; index++) {
        result[itemCount - 1 - index] = data[indexes[index]];
      }
    }

    return result;
  }
}
