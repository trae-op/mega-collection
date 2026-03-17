import { State } from "../State";
import {
  CollectionItem,
  SortDescriptor,
  SortDirection,
  type StateMutation,
  type UpdateDescriptor,
} from "../types";
import type { SortEngineOptions, SortIndex, SortRuntime } from "./types";
import { SortEngineError } from "./errors";

const MERGE_SHARED_SCOPE = "__merge__";
const DEFER_SORT_MUTATION_CACHE_UPDATES_KEY = "deferSortMutationCacheUpdates";

// ---------------------------------------------------------------------------
// Radix-sort helpers (LSD, 2-pass, base 2^16)
// ---------------------------------------------------------------------------

/**
 * Returns true if every value in `values` is a non-negative 32-bit integer,
 * i.e. it can be treated as a Uint32 without precision loss.
 */
function canUseUint32Radix(values: Float64Array, n: number): boolean {
  for (let i = 0; i < n; i++) {
    const v = values[i];
    // v >>> 0 converts to Uint32; equality fails for negatives, floats, or v > 2^32-1
    if (v !== v >>> 0) return false;
  }
  return true;
}

/**
 * 2-pass LSD radix sort — sorts `indexes` so that `values[indexes[i]]` is
 * non-decreasing.  Requires all values to be in [0, 2^32-1] integers.
 *
 * Time  O(2n + 2·65536)  ≈ O(n)
 * Space O(n + 65536)     for temp buffer + count array
 */
function radixSortUint32(
  indexes: Uint32Array,
  values: Float64Array,
  n: number,
): void {
  const temp = new Uint32Array(n);
  const count = new Uint32Array(65536);

  // Pass 1 — lower 16 bits
  for (let i = 0; i < n; i++) count[values[indexes[i]] & 0xffff]++;
  let s = 0;
  for (let i = 0; i < 65536; i++) {
    const c = count[i];
    count[i] = s;
    s += c;
  }
  for (let i = 0; i < n; i++) {
    const b = values[indexes[i]] & 0xffff;
    temp[count[b]++] = indexes[i];
  }

  // Pass 2 — upper 16 bits
  count.fill(0);
  for (let i = 0; i < n; i++) count[(values[temp[i]] >>> 16) & 0xffff]++;
  s = 0;
  for (let i = 0; i < 65536; i++) {
    const c = count[i];
    count[i] = s;
    s += c;
  }
  for (let i = 0; i < n; i++) {
    const b = (values[temp[i]] >>> 16) & 0xffff;
    indexes[count[b]++] = temp[i];
  }
}

// ---------------------------------------------------------------------------

const createSortRuntime = <T extends CollectionItem>(): SortRuntime<T> => ({
  indexedFields: new Set<keyof T & string>(),
  cache: new Map<string, SortIndex<T>>(),
});

export class SortEngine<T extends CollectionItem> {
  private readonly state: State<T>;

  private readonly namespace: string;

  constructor(options: SortEngineOptions<T> & { state?: State<T> } = {}) {
    this.state = options.state ?? new State(options.data ?? []);
    this.namespace = this.state.createNamespace("sort");
    this.state.subscribe((mutation) => this.handleStateMutation(mutation));

    if (options.fields?.length) {
      for (const field of options.fields) {
        this.indexedFields.add(field);
      }

      if (this.dataset.length > 0) {
        this.rebuildConfiguredIndexes();
      }
    }
  }

  private get dataset(): T[] {
    return this.state.getOriginData();
  }

  private get runtime(): SortRuntime<T> {
    return this.state.getOrCreateScopedValue<SortRuntime<T>>(
      this.namespace,
      "runtime",
      createSortRuntime,
    );
  }

  private get cache(): Map<string, SortIndex<T>> {
    return this.runtime.cache;
  }

  private get indexedFields(): Set<keyof T & string> {
    return this.runtime.indexedFields;
  }

  private shouldDeferMutationCacheUpdates(): boolean {
    return (
      this.state.getScopedValue<boolean>(
        MERGE_SHARED_SCOPE,
        DEFER_SORT_MUTATION_CACHE_UPDATES_KEY,
      ) === true
    );
  }

  private invalidateCachedIndexes(): void {
    for (const field of this.indexedFields) {
      this.cache.delete(field as string);
    }
  }

  private rebuildConfiguredIndexes(): void {
    this.cache.clear();

    for (const field of this.indexedFields) {
      this.buildIndexForDataset(field);
    }
  }

  private buildIndexForDataset(field: keyof T & string): void {
    if (!this.dataset.length) return;

    this.buildIndexFromData(this.dataset, field);
  }

  private buildIndexFromData(data: T[], field: keyof T & string): void {
    const itemCount = data.length;
    const indexes = new Uint32Array(itemCount);
    for (let i = 0; i < itemCount; i++) indexes[i] = i;

    // Probe the type from the first non-null element before allocating buffers,
    // so numeric fields use a single Float64Array without an intermediate unknown[].
    let probe = 0;
    while (probe < itemCount && data[probe][field] == null) probe++;
    const isNumeric =
      probe < itemCount && typeof data[probe][field] === "number";

    if (isNumeric) {
      const numericValues = new Float64Array(itemCount);
      for (let i = 0; i < itemCount; i++) {
        numericValues[i] = data[i][field] as number;
      }
      if (canUseUint32Radix(numericValues, itemCount)) {
        radixSortUint32(indexes, numericValues, itemCount);
      } else {
        indexes.sort((a, b) => numericValues[a] - numericValues[b]);
      }
    } else {
      const strValues = new Array<string>(itemCount);
      for (let i = 0; i < itemCount; i++) {
        strValues[i] = data[i][field] as string;
      }
      indexes.sort((a, b) => {
        const av = strValues[a];
        const bv = strValues[b];
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
    }

    const reverseIndex = new Uint32Array(itemCount);
    for (let i = 0; i < itemCount; i++) {
      reverseIndex[indexes[i]] = i;
    }

    this.cache.set(field as string, {
      indexes,
      reverseIndex,
      ascItems: null,
      descItems: null,
      hasDuplicateValues: this.hasDuplicateValuesForIndexes(
        data,
        indexes,
        field,
      ),
      version: this.state.getMutationVersion(),
    });
  }

  clearIndexes(): this {
    this.cache.clear();
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

  private applyAddedItems(startIndex: number, count: number): this {
    if (count === 0) {
      return this;
    }

    if (this.shouldDeferMutationCacheUpdates()) {
      this.invalidateCachedIndexes();
      return this;
    }

    for (const field of this.indexedFields) {
      const cachedIndex = this.cache.get(field as string);

      if (!cachedIndex) {
        continue;
      }

      if (!this.shouldMaintainIncrementally(cachedIndex)) {
        this.cache.delete(field as string);
        continue;
      }

      this.updateCachedIndexForAddedItems(field, startIndex, count);
    }

    return this;
  }

  getOriginData(): T[] {
    return this.state.getOriginData();
  }

  private handleStateMutation(mutation: StateMutation<T>): void {
    switch (mutation.type) {
      case "add":
        this.applyAddedItems(mutation.startIndex, mutation.items.length);
        return;
      case "update":
        this.applyUpdatedItem(
          mutation.index,
          mutation.previousItem,
          mutation.nextItem,
        );
        return;
      case "data":
        this.rebuildConfiguredIndexes();
        return;
      case "clearData":
        this.cache.clear();
        return;
      case "remove":
        this.applyRemovedItem(mutation.removedIndex, mutation.movedFromIndex);
        return;
      case "removeMany":
        this.applyRemovedItemsBatch(mutation.entries);
        return;
    }
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

      if (usesStoredDataset && this.indexedFields.has(field)) {
        let cached = this.cache.get(field as string);
        const currentVersion = this.state.getMutationVersion();

        if (!cached || cached.version !== currentVersion) {
          this.buildIndexForDataset(field);
          cached = this.cache.get(field as string)!;
        }

        return this.getCachedSortedItems(cached, direction);
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
    for (let i = 0; i < itemCount; i++) values[i] = data[i][field] as number;

    const indexes = new Uint32Array(itemCount);
    for (let i = 0; i < itemCount; i++) indexes[i] = i;

    if (canUseUint32Radix(values, itemCount)) {
      radixSortUint32(indexes, values, itemCount);
    } else {
      indexes.sort((a, b) => values[a] - values[b]);
    }

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

    if (usesStoredDataset && this.indexedFields.has(primary.field)) {
      let cached = this.cache.get(primary.field as string);
      const currentVersion = this.state.getMutationVersion();

      if (!cached || cached.version !== currentVersion) {
        this.buildIndexForDataset(primary.field);
        cached = this.cache.get(primary.field as string)!;
      }

      const primarySorted = cached.hasDuplicateValues
        ? this.getCachedSortedItems(cached, primary.direction).slice()
        : this.getCachedSortedItems(cached, primary.direction);

      if (!cached.hasDuplicateValues) {
        return primarySorted;
      }

      return this.sortTieGroups(primarySorted, primary.field, rest);
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
    return this.materializeItemsFromIndexes(data, indexes, direction);
  }

  private materializeItemsFromIndexes(
    data: T[],
    indexes: Uint32Array,
    direction: SortDirection,
  ): T[] {
    const itemCount = indexes.length;
    const result: T[] = new Array(itemCount);

    if (direction === "asc") {
      for (let i = 0; i < itemCount; i++) {
        result[i] = data[indexes[i]];
      }

      return result;
    }

    for (let i = 0; i < itemCount; i++) {
      result[i] = data[indexes[itemCount - 1 - i]];
    }

    return result;
  }

  private getCachedSortedItems(
    cachedIndex: SortIndex<T>,
    direction: SortDirection,
  ): T[] {
    if (direction === "asc") {
      if (cachedIndex.ascItems === null) {
        cachedIndex.ascItems = this.materializeItemsFromIndexes(
          this.dataset,
          cachedIndex.indexes,
          "asc",
        );
      }

      return cachedIndex.ascItems;
    }

    if (cachedIndex.descItems !== null) {
      return cachedIndex.descItems;
    }

    const ascItems = this.getCachedSortedItems(cachedIndex, "asc");
    cachedIndex.descItems = ascItems.slice().reverse();
    return cachedIndex.descItems;
  }

  private shouldMaintainIncrementally(cachedIndex: SortIndex<T>): boolean {
    return cachedIndex.ascItems !== null || cachedIndex.descItems !== null;
  }

  private hasDuplicateValuesForIndexes(
    data: T[],
    indexes: ArrayLike<number>,
    field: keyof T & string,
  ): boolean {
    for (let index = 1; index < indexes.length; index++) {
      if (data[indexes[index - 1]][field] === data[indexes[index]][field]) {
        return true;
      }
    }

    return false;
  }

  private compareIndexesByField(
    field: keyof T & string,
    leftIndex: number,
    rightIndex: number,
  ): number {
    const lv = this.dataset[leftIndex][field];
    const rv = this.dataset[rightIndex][field];

    if (typeof lv === "number" && typeof rv === "number") {
      const diff = lv - rv;
      if (diff !== 0) return diff;
    } else {
      if (lv < rv) return -1;
      if (lv > rv) return 1;
    }

    return leftIndex - rightIndex;
  }

  private applyUpdatedItem(index: number, previousItem: T, nextItem: T): void {
    if (this.shouldDeferMutationCacheUpdates()) {
      this.invalidateCachedIndexes();
      return;
    }

    for (const field of this.indexedFields) {
      if (previousItem[field] === nextItem[field]) continue;

      const cachedIndex = this.cache.get(field as string);
      if (!cachedIndex) continue;

      if (!this.shouldMaintainIncrementally(cachedIndex)) {
        this.cache.delete(field as string);
        continue;
      }

      this.updateCachedIndexForUpdatedItem(field, index);
    }
  }

  private updateCachedIndexForUpdatedItem(
    field: keyof T & string,
    targetIndex: number,
  ): void {
    const cachedIndex = this.cache.get(field as string);
    if (!cachedIndex) return;

    const { indexes, reverseIndex } = cachedIndex;
    const itemCount = indexes.length;

    // O(1) lookup via reverse index instead of O(n) linear scan
    const currentPosition = reverseIndex[targetIndex];

    if (
      currentPosition >= itemCount ||
      indexes[currentPosition] !== targetIndex
    ) {
      this.cache.delete(field as string);
      return;
    }

    // Remove from current position by shifting left in-place
    indexes.copyWithin(currentPosition, currentPosition + 1);

    // Binary search for the new position in the reduced range [0, itemCount-1)
    const reducedCount = itemCount - 1;
    let low = 0;
    let high = reducedCount;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (
        this.compareIndexesByField(field, indexes[middle], targetIndex) <= 0
      ) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    const nextPosition = low;

    // Insert at new position by shifting right in-place
    indexes.copyWithin(nextPosition + 1, nextPosition, reducedCount);
    indexes[nextPosition] = targetIndex;

    if (cachedIndex.ascItems !== null) {
      cachedIndex.ascItems.copyWithin(currentPosition, currentPosition + 1);
      cachedIndex.ascItems.copyWithin(
        nextPosition + 1,
        nextPosition,
        reducedCount,
      );
      cachedIndex.ascItems[nextPosition] = this.dataset[targetIndex];
    }

    // Rebuild reverseIndex for affected range
    const minPos = Math.min(currentPosition, nextPosition);
    const maxPos = Math.max(currentPosition, nextPosition);
    for (let i = minPos; i <= maxPos; i++) {
      reverseIndex[indexes[i]] = i;
    }

    cachedIndex.descItems = null;

    if (!cachedIndex.hasDuplicateValues) {
      const previousNeighbor =
        nextPosition > 0 ? indexes[nextPosition - 1] : -1;
      const nextNeighbor =
        nextPosition + 1 < itemCount ? indexes[nextPosition + 1] : -1;

      cachedIndex.hasDuplicateValues =
        (previousNeighbor !== -1 &&
          this.dataset[previousNeighbor][field] ===
            this.dataset[targetIndex][field]) ||
        (nextNeighbor !== -1 &&
          this.dataset[nextNeighbor][field] ===
            this.dataset[targetIndex][field]);
    }

    cachedIndex.version = this.state.getMutationVersion();
  }

  private updateCachedIndexForAddedItems(
    field: keyof T & string,
    startIndex: number,
    count: number,
  ): void {
    const cachedIndex = this.cache.get(field as string);
    if (!cachedIndex) {
      return;
    }

    const addedIndexes = new Array<number>(count);
    for (let index = 0; index < count; index++) {
      addedIndexes[index] = startIndex + index;
    }
    addedIndexes.sort((left, right) =>
      this.compareIndexesByField(field, left, right),
    );

    const merged = new Uint32Array(cachedIndex.indexes.length + count);
    let previousMergedIndex = -1;
    let nextHasDuplicates = cachedIndex.hasDuplicateValues;

    let leftIndex = 0;
    let rightIndex = 0;
    let writeIndex = 0;

    while (
      leftIndex < cachedIndex.indexes.length &&
      rightIndex < addedIndexes.length
    ) {
      const nextIndex =
        this.compareIndexesByField(
          field,
          cachedIndex.indexes[leftIndex],
          addedIndexes[rightIndex],
        ) <= 0
          ? cachedIndex.indexes[leftIndex++]
          : addedIndexes[rightIndex++];

      merged[writeIndex] = nextIndex;
      if (
        !nextHasDuplicates &&
        previousMergedIndex !== -1 &&
        this.dataset[previousMergedIndex][field] ===
          this.dataset[nextIndex][field]
      ) {
        nextHasDuplicates = true;
      }

      previousMergedIndex = nextIndex;
      writeIndex += 1;
    }

    while (leftIndex < cachedIndex.indexes.length) {
      const nextIndex = cachedIndex.indexes[leftIndex++];
      merged[writeIndex] = nextIndex;
      if (
        !nextHasDuplicates &&
        previousMergedIndex !== -1 &&
        this.dataset[previousMergedIndex][field] ===
          this.dataset[nextIndex][field]
      ) {
        nextHasDuplicates = true;
      }

      previousMergedIndex = nextIndex;
      writeIndex += 1;
    }

    while (rightIndex < addedIndexes.length) {
      const nextIndex = addedIndexes[rightIndex++];
      merged[writeIndex] = nextIndex;
      if (
        !nextHasDuplicates &&
        previousMergedIndex !== -1 &&
        this.dataset[previousMergedIndex][field] ===
          this.dataset[nextIndex][field]
      ) {
        nextHasDuplicates = true;
      }

      previousMergedIndex = nextIndex;
      writeIndex += 1;
    }

    const reverseIndex = new Uint32Array(merged.length);
    for (let index = 0; index < merged.length; index++) {
      reverseIndex[merged[index]] = index;
    }

    cachedIndex.indexes = merged;
    cachedIndex.reverseIndex = reverseIndex;
    cachedIndex.ascItems = cachedIndex.ascItems
      ? this.materializeItemsFromIndexes(this.dataset, merged, "asc")
      : null;
    cachedIndex.descItems = null;
    cachedIndex.hasDuplicateValues = nextHasDuplicates;
    cachedIndex.version = this.state.getMutationVersion();
  }

  private applyRemovedItem(
    removedIndex: number,
    movedFromIndex: number | null,
  ): void {
    if (this.shouldDeferMutationCacheUpdates()) {
      this.invalidateCachedIndexes();
      return;
    }

    for (const field of this.indexedFields) {
      const cachedIndex = this.cache.get(field as string);

      if (!cachedIndex) {
        continue;
      }

      if (!this.shouldMaintainIncrementally(cachedIndex)) {
        this.cache.delete(field as string);
        continue;
      }

      this.updateCachedIndexForRemovedItem(field, removedIndex, movedFromIndex);
    }
  }

  private applyRemovedItemsBatch(
    entries: Array<{
      removedIndex: number;
      movedFromIndex: number | null;
    }>,
  ): void {
    if (this.shouldDeferMutationCacheUpdates()) {
      this.invalidateCachedIndexes();
      return;
    }

    for (const field of this.indexedFields) {
      const cachedIndex = this.cache.get(field as string);

      if (!cachedIndex) {
        continue;
      }

      if (!this.shouldMaintainIncrementally(cachedIndex)) {
        this.cache.delete(field as string);
        continue;
      }

      if (!cachedIndex.hasDuplicateValues) {
        this.updateUniqueCachedIndexForRemovedItems(cachedIndex, entries);
        cachedIndex.version = this.state.getMutationVersion();
        continue;
      }

      this.cache.delete(field as string);
    }
  }

  private updateCachedIndexForRemovedItem(
    field: keyof T & string,
    removedIndex: number,
    movedFromIndex: number | null,
  ): void {
    const cachedIndex = this.cache.get(field as string);
    if (!cachedIndex) {
      return;
    }

    if (!cachedIndex.hasDuplicateValues) {
      this.updateUniqueCachedIndexForRemovedItem(
        cachedIndex,
        removedIndex,
        movedFromIndex,
      );
      cachedIndex.version = this.state.getMutationVersion();
      return;
    }

    const nextIndexesList: number[] = [];

    for (let index = 0; index < cachedIndex.indexes.length; index++) {
      const datasetIndex = cachedIndex.indexes[index];

      if (datasetIndex === removedIndex || datasetIndex === movedFromIndex) {
        continue;
      }

      nextIndexesList.push(datasetIndex);
    }

    if (movedFromIndex !== null && movedFromIndex !== removedIndex) {
      let low = 0;
      let high = nextIndexesList.length;

      while (low < high) {
        const middle = (low + high) >> 1;

        if (
          this.compareIndexesByField(
            field,
            nextIndexesList[middle],
            removedIndex,
          ) <= 0
        ) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }

      nextIndexesList.splice(low, 0, removedIndex);
    }

    const nextIndexes = Uint32Array.from(nextIndexesList);
    const nextReverseIndex = new Uint32Array(this.dataset.length);
    for (let index = 0; index < nextIndexes.length; index++) {
      const datasetIndex = nextIndexes[index];
      nextReverseIndex[datasetIndex] = index;
    }

    cachedIndex.indexes = nextIndexes;
    cachedIndex.reverseIndex = nextReverseIndex;
    cachedIndex.ascItems = cachedIndex.ascItems
      ? this.materializeItemsFromIndexes(this.dataset, nextIndexes, "asc")
      : null;
    cachedIndex.descItems = null;
    cachedIndex.hasDuplicateValues = cachedIndex.hasDuplicateValues
      ? this.hasDuplicateValuesForIndexes(this.dataset, nextIndexes, field)
      : false;
    cachedIndex.version = this.state.getMutationVersion();
  }

  private updateUniqueCachedIndexForRemovedItem(
    cachedIndex: SortIndex<T>,
    removedIndex: number,
    movedFromIndex: number | null,
  ): void {
    const nextLength = cachedIndex.indexes.length - 1;
    const nextIndexes = new Uint32Array(nextLength);
    const nextReverseIndex = new Uint32Array(this.dataset.length);
    const nextAscItems =
      cachedIndex.ascItems !== null ? new Array<T>(nextLength) : null;

    let writeIndex = 0;

    for (let index = 0; index < cachedIndex.indexes.length; index++) {
      const currentDatasetIndex = cachedIndex.indexes[index];

      if (currentDatasetIndex === removedIndex) {
        continue;
      }

      const nextDatasetIndex =
        movedFromIndex !== null && currentDatasetIndex === movedFromIndex
          ? removedIndex
          : currentDatasetIndex;

      nextIndexes[writeIndex] = nextDatasetIndex;
      nextReverseIndex[nextDatasetIndex] = writeIndex;

      if (nextAscItems !== null) {
        nextAscItems[writeIndex] = this.dataset[nextDatasetIndex];
      }

      writeIndex += 1;
    }

    cachedIndex.indexes = nextIndexes;
    cachedIndex.reverseIndex = nextReverseIndex;
    cachedIndex.ascItems = nextAscItems;
    cachedIndex.descItems = null;
  }

  private updateUniqueCachedIndexForRemovedItems(
    cachedIndex: SortIndex<T>,
    entries: Array<{
      removedIndex: number;
      movedFromIndex: number | null;
    }>,
  ): void {
    const originalLength = cachedIndex.indexes.length;
    const slotToOriginalIndex = new Uint32Array(originalLength);
    const finalIndexByOriginalIndex = new Int32Array(originalLength);

    for (let index = 0; index < originalLength; index++) {
      slotToOriginalIndex[index] = index;
      finalIndexByOriginalIndex[index] = -1;
    }

    let currentLength = originalLength;

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex];

      if (entry.movedFromIndex !== null) {
        slotToOriginalIndex[entry.removedIndex] =
          slotToOriginalIndex[entry.movedFromIndex];
      }

      currentLength -= 1;
    }

    const nextIndexes = new Uint32Array(currentLength);
    const nextReverseIndex = new Uint32Array(currentLength);
    const nextAscItems =
      cachedIndex.ascItems !== null ? new Array<T>(currentLength) : null;

    for (let finalIndex = 0; finalIndex < currentLength; finalIndex++) {
      finalIndexByOriginalIndex[slotToOriginalIndex[finalIndex]] = finalIndex;
    }

    let writeIndex = 0;

    for (let index = 0; index < cachedIndex.indexes.length; index++) {
      const originalIndex = cachedIndex.indexes[index];
      const finalIndex = finalIndexByOriginalIndex[originalIndex];

      if (finalIndex === -1) {
        continue;
      }

      nextIndexes[writeIndex] = finalIndex;
      nextReverseIndex[finalIndex] = writeIndex;

      if (nextAscItems !== null) {
        nextAscItems[writeIndex] = this.dataset[finalIndex];
      }

      writeIndex += 1;
    }

    cachedIndex.indexes = nextIndexes;
    cachedIndex.reverseIndex = nextReverseIndex;
    cachedIndex.ascItems = nextAscItems;
    cachedIndex.descItems = null;
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
