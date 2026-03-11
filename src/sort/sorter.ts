import { CollectionItem, SortDescriptor, SortDirection } from "../types";
import type { SortEngineOptions, SortIndex } from "./types";
import { SortEngineError } from "./errors";

export class SortEngine<T extends CollectionItem> {
  private cache = new Map<string, SortIndex<T>>();

  private dataset: T[] = [];

  private readonly indexedFields = new Set<keyof T & string>();

  private readonly dirtyIndexedFields = new Set<keyof T & string>();

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
      this.buildIndexForDataset(field);
    }
  }

  private buildIndexForDataset(field: keyof T & string): void {
    if (!this.dataset.length) {
      throw SortEngineError.missingDatasetForBuildIndex();
    }

    this.buildIndexFromData(this.dataset, field);
  }

  private buildIndexFromData(data: T[], field: keyof T & string): void {
    const itemCount = data.length;
    const indexes = new Uint32Array(itemCount);
    const fieldValues = new Array<unknown>(itemCount);

    for (let i = 0; i < itemCount; i++) {
      indexes[i] = i;
      fieldValues[i] = data[i][field];
    }

    if (typeof fieldValues[0] === "number") {
      const numericValues = new Float64Array(itemCount);
      for (let i = 0; i < itemCount; i++) {
        numericValues[i] = fieldValues[i] as number;
      }
      indexes.sort((a, b) => numericValues[a] - numericValues[b]);
    } else {
      indexes.sort((a, b) => {
        const av = fieldValues[a] as string;
        const bv = fieldValues[b] as string;
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
    }

    this.cache.set(field as string, { indexes, dataRef: data, itemCount });
    this.dirtyIndexedFields.delete(field);
  }

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
    if (items.length === 0) return this;

    const startIndex = appendToDataset
      ? this.dataset.length
      : this.dataset.length - items.length;

    if (appendToDataset) {
      this.dataset.push(...items);
    }

    for (const field of this.indexedFields) {
      const cachedIndex = this.cache.get(field as string);

      if (!cachedIndex) continue;

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

  sort(descriptors: SortDescriptor<T>[]): T[];
  sort(data: T[], descriptors: SortDescriptor<T>[], inPlace?: boolean): T[];
  sort(
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace = false,
  ): T[] {
    const usesStoredDataset = descriptors === undefined;

    let data: T[];
    let resolvedDescriptors: SortDescriptor<T>[];

    if (usesStoredDataset) {
      if (!this.dataset.length) throw SortEngineError.missingDatasetForSort();
      data = this.dataset;
      resolvedDescriptors = dataOrDescriptors as SortDescriptor<T>[];
    } else {
      data = dataOrDescriptors as T[];
      resolvedDescriptors = descriptors;
    }

    if (resolvedDescriptors.length === 0 || data.length === 0) return data;

    if (resolvedDescriptors.length === 1) {
      const { field, direction } = resolvedDescriptors[0];

      if (
        usesStoredDataset &&
        this.dirtyIndexedFields.has(field) &&
        this.cache.has(field as string)
      ) {
        this.buildIndexForDataset(field);
      }

      const cached = this.cache.get(field as string);

      if (
        usesStoredDataset &&
        cached?.dataRef === data &&
        cached.itemCount === data.length
      ) {
        return this.reconstructFromIndex(data, cached.indexes, direction);
      }

      return this.sortNumericFastPath(data, field, direction, inPlace);
    }

    return this.sortMultiField(
      data,
      resolvedDescriptors,
      inPlace,
      usesStoredDataset,
    );
  }

  private sortNumericFastPath(
    data: T[],
    field: keyof T & string,
    direction: SortDirection,
    inPlace: boolean,
  ): T[] {
    if (data.length === 0 || typeof data[0][field] !== "number") {
      const sortable = inPlace ? data : data.slice();
      sortable.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return direction === "asc" ? cmp : -cmp;
      });
      return sortable;
    }

    const itemCount = data.length;
    const values = new Float64Array(itemCount);

    for (let i = 0; i < itemCount; i++) {
      values[i] = data[i][field] as number;
    }

    const indexes = new Uint32Array(itemCount);
    for (let i = 0; i < itemCount; i++) indexes[i] = i;
    indexes.sort((a, b) => values[a] - values[b]);

    return this.reconstructFromIndex(data, indexes, direction);
  }

  // Uses cached index of first field, then sorts only tie-groups by remaining fields
  private sortMultiField(
    data: T[],
    descriptors: SortDescriptor<T>[],
    inPlace: boolean,
    usesStoredDataset: boolean,
  ): T[] {
    const [primary, ...rest] = descriptors;

    if (usesStoredDataset) {
      if (
        this.dirtyIndexedFields.has(primary.field) &&
        this.cache.has(primary.field as string)
      ) {
        this.buildIndexForDataset(primary.field);
      }

      const cached = this.cache.get(primary.field as string);

      if (cached?.dataRef === data && cached.itemCount === data.length) {
        const primarySorted = this.reconstructFromIndex(
          data,
          cached.indexes,
          primary.direction,
        );
        return this.sortTieGroups(primarySorted, primary.field, rest);
      }
    }

    const sortable = inPlace ? data : data.slice();
    const comparator = this.buildComparator(descriptors);
    sortable.sort(comparator);
    return sortable;
  }

  // Finds groups of equal values in the primary field and sorts each group by remaining descriptors
  private sortTieGroups(
    data: T[],
    primaryField: keyof T & string,
    remainingDescriptors: SortDescriptor<T>[],
  ): T[] {
    if (remainingDescriptors.length === 0) return data;

    const comparator = this.buildComparator(remainingDescriptors);
    const itemCount = data.length;
    let groupStart = 0;

    while (groupStart < itemCount) {
      let groupEnd = groupStart + 1;
      const groupValue = data[groupStart][primaryField];

      while (
        groupEnd < itemCount &&
        data[groupEnd][primaryField] === groupValue
      ) {
        groupEnd++;
      }

      if (groupEnd - groupStart > 1) {
        const group = data.slice(groupStart, groupEnd);
        group.sort(comparator);
        for (let i = groupStart; i < groupEnd; i++) {
          data[i] = group[i - groupStart];
        }
      }

      groupStart = groupEnd;
    }

    return data;
  }

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
    if (!cachedIndex) return;

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

    for (let i = 0; i < itemCount; i++) {
      indexes[i] = startIndex + i;
    }

    indexes.sort((l, r) => this.compareIndexesByField(field, l, r));
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

    let ei = 0;
    let ai = 0;
    let wi = 0;

    while (ei < existingIndexes.length && ai < appendedIndexes.length) {
      if (
        this.compareIndexesByField(
          field,
          existingIndexes[ei],
          appendedIndexes[ai],
        ) <= 0
      ) {
        mergedIndexes[wi++] = existingIndexes[ei++];
      } else {
        mergedIndexes[wi++] = appendedIndexes[ai++];
      }
    }

    while (ei < existingIndexes.length)
      mergedIndexes[wi++] = existingIndexes[ei++];
    while (ai < appendedIndexes.length)
      mergedIndexes[wi++] = appendedIndexes[ai++];

    return mergedIndexes;
  }

  private compareIndexesByField(
    field: keyof T & string,
    leftIndex: number,
    rightIndex: number,
  ): number {
    const lv = this.dataset[leftIndex]?.[field];
    const rv = this.dataset[rightIndex]?.[field];

    if (typeof lv === "number" && typeof rv === "number") {
      const diff = lv - rv;
      if (diff !== 0) return diff;
    } else {
      if (lv < rv) return -1;
      if (lv > rv) return 1;
    }

    return leftIndex - rightIndex;
  }

  private buildComparator(
    descriptors: SortDescriptor<T>[],
  ): (a: T, b: T) => number {
    const fields = descriptors.map(({ field }) => field);
    const multipliers = descriptors.map(({ direction }) =>
      direction === "asc" ? 1 : -1,
    );
    const fieldCount = fields.length;

    return (a: T, b: T): number => {
      for (let i = 0; i < fieldCount; i++) {
        const lv = a[fields[i]];
        const rv = b[fields[i]];
        if (lv < rv) return -multipliers[i];
        if (lv > rv) return multipliers[i];
      }
      return 0;
    };
  }
}
