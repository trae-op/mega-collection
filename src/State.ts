import type {
  CollectionItem,
  IndexableKey,
  StateListener,
  StateRemoveManyEntry,
  StateMutation,
  StateOptions,
  StatePreviousResult,
  StateRegistryFactory,
  UpdateDescriptor,
} from "./types";

export class State<T extends CollectionItem> {
  private originData: T[];

  private filterByPreviousResult: boolean;

  private itemIndexLookup = new WeakMap<T, number>();

  private mutationVersion = 0;

  private namespaceSequence = 0;

  private previousResultState: StatePreviousResult<T> | null = null;

  private readonly indexMaps = new Map<
    IndexableKey<T> & string,
    Map<any, number>
  >();

  private readonly scopedRegistry = new Map<string, Map<string, unknown>>();

  private readonly listeners = new Set<StateListener<T>>();

  constructor(data: T[] = [], options: StateOptions = {}) {
    this.originData = data;
    this.filterByPreviousResult = options.filterByPreviousResult ?? false;
    this.rebuildItemIndexLookup();
  }

  subscribe(listener: StateListener<T>): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  getOriginData(): T[] {
    return this.originData;
  }

  getItemIndex(item: T): number | undefined {
    return this.itemIndexLookup.get(item);
  }

  getMutationVersion(): number {
    return this.mutationVersion;
  }

  isFilterByPreviousResultEnabled(): boolean {
    return this.filterByPreviousResult;
  }

  setFilterByPreviousResult(enabled: boolean): void {
    this.filterByPreviousResult = enabled;

    if (!enabled) {
      this.clearPreviousResult();
    }
  }

  getPreviousResult(): T[] | null {
    return this.getPreviousResultState()?.result ?? null;
  }

  getPreviousResultState(): StatePreviousResult<T> | null {
    if (
      this.previousResultState === null ||
      this.previousResultState.version !== this.mutationVersion
    ) {
      return null;
    }

    return this.previousResultState;
  }

  setPreviousResult(result: T[], sourceData: T[]): void {
    this.previousResultState = {
      result,
      sourceData,
      version: this.mutationVersion,
    };
  }

  clearPreviousResult(): void {
    this.previousResultState = null;
  }

  createNamespace(prefix = "scope"): string {
    this.namespaceSequence += 1;
    return `${prefix}:${this.namespaceSequence}`;
  }

  getScopedValue<TValue>(namespace: string, key: string): TValue | undefined {
    return this.scopedRegistry.get(namespace)?.get(key) as TValue | undefined;
  }

  getOrCreateScopedValue<TValue>(
    namespace: string,
    key: string,
    createValue: StateRegistryFactory<TValue>,
  ): TValue {
    const existingValue = this.getScopedValue<TValue>(namespace, key);

    if (existingValue !== undefined) {
      return existingValue;
    }

    const scopedValues = this.getOrCreateScope(namespace);
    const nextValue = createValue();
    scopedValues.set(key, nextValue);
    return nextValue;
  }

  setScopedValue<TValue>(
    namespace: string,
    key: string,
    value: TValue,
  ): TValue {
    const scopedValues = this.getOrCreateScope(namespace);
    scopedValues.set(key, value);
    return value;
  }

  deleteScopedValue(namespace: string, key: string): void {
    const scopedValues = this.scopedRegistry.get(namespace);

    if (!scopedValues) {
      return;
    }

    scopedValues.delete(key);

    if (scopedValues.size === 0) {
      this.scopedRegistry.delete(namespace);
    }
  }

  clearScope(namespace: string): void {
    this.scopedRegistry.delete(namespace);
  }

  data(data: T[]): void {
    this.originData = data;
    this.bumpMutationVersion();
    this.rebuildItemIndexLookup();

    for (const field of this.indexMaps.keys()) {
      this.rebuildIndexMap(field);
    }

    this.emit({ type: "data", data });
  }

  add(items: T[]): void {
    if (items.length === 0) {
      return;
    }

    const startIndex = this.originData.length;
    for (let i = 0; i < items.length; i++) {
      this.originData.push(items[i]);
      this.itemIndexLookup.set(items[i], startIndex + i);
    }
    this.bumpMutationVersion();

    for (const [field, indexMap] of this.indexMaps) {
      for (let itemOffset = 0; itemOffset < items.length; itemOffset++) {
        indexMap.set(items[itemOffset][field], startIndex + itemOffset);
      }
    }

    this.emit({ type: "add", items, startIndex });
  }

  update(descriptor: UpdateDescriptor<T>): void {
    const { field, data } = descriptor;
    const fieldValue = data[field];

    if (fieldValue === undefined || fieldValue === null) {
      return;
    }

    const indexMap = this.getOrCreateIndexMap(field);
    const itemIndex = indexMap.get(fieldValue);

    if (itemIndex === undefined) {
      return;
    }

    const previousItem = this.originData[itemIndex];
    this.originData[itemIndex] = data;
    this.itemIndexLookup.delete(previousItem);
    this.itemIndexLookup.set(data, itemIndex);
    this.bumpMutationVersion();

    for (const [indexedField, indexedFieldMap] of this.indexMaps) {
      const previousFieldValue = previousItem[indexedField];
      const nextFieldValue = data[indexedField];

      if (previousFieldValue === nextFieldValue) {
        continue;
      }

      if (indexedFieldMap.get(previousFieldValue) === itemIndex) {
        indexedFieldMap.delete(previousFieldValue);
      }

      indexedFieldMap.set(nextFieldValue, itemIndex);
    }

    this.emit({
      type: "update",
      field,
      index: itemIndex,
      previousItem,
      nextItem: data,
    });
  }

  clearData(): void {
    const data: T[] = [];
    this.originData = data;
    this.itemIndexLookup = new WeakMap<T, number>();
    this.bumpMutationVersion();

    for (const indexMap of this.indexMaps.values()) {
      indexMap.clear();
    }

    this.emit({ type: "clearData", data });
  }

  removeByFieldValue(field: IndexableKey<T> & string, value: any): void {
    const indexMap = this.getOrCreateIndexMap(field);
    const itemIndex = indexMap.get(value);

    if (itemIndex === undefined) {
      return;
    }

    const lastIndex = this.originData.length - 1;
    const removedItem = this.originData[itemIndex];
    const movedItem =
      itemIndex === lastIndex ? null : this.originData[lastIndex];

    if (itemIndex !== lastIndex && movedItem) {
      this.originData[itemIndex] = movedItem;
      this.itemIndexLookup.set(movedItem, itemIndex);
    }

    this.originData.pop();
    this.itemIndexLookup.delete(removedItem);
    this.bumpMutationVersion();

    for (const [indexedField, indexedFieldMap] of this.indexMaps) {
      const removedFieldValue = removedItem[indexedField];

      if (indexedFieldMap.get(removedFieldValue) === itemIndex) {
        indexedFieldMap.delete(removedFieldValue);
      }

      if (movedItem) {
        indexedFieldMap.set(movedItem[indexedField], itemIndex);
      }
    }

    this.emit({
      type: "remove",
      field,
      value,
      removedItem,
      removedIndex: itemIndex,
      movedItem,
      movedFromIndex: movedItem ? lastIndex : null,
    });
  }

  removeByFieldValues(field: IndexableKey<T> & string, values: any[]): void {
    if (values.length === 0) {
      return;
    }

    const indexMap = this.getOrCreateIndexMap(field);
    const entries: StateRemoveManyEntry<T>[] = [];

    for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
      const value = values[valueIndex];
      const itemIndex = indexMap.get(value);

      if (itemIndex === undefined) {
        continue;
      }

      const lastIndex = this.originData.length - 1;
      const removedItem = this.originData[itemIndex];
      const movedItem =
        itemIndex === lastIndex ? null : this.originData[lastIndex];

      if (itemIndex !== lastIndex && movedItem) {
        this.originData[itemIndex] = movedItem;
        this.itemIndexLookup.set(movedItem, itemIndex);
      }

      this.originData.pop();
      this.itemIndexLookup.delete(removedItem);

      for (const [indexedField, indexedFieldMap] of this.indexMaps) {
        const removedFieldValue = removedItem[indexedField];

        if (indexedFieldMap.get(removedFieldValue) === itemIndex) {
          indexedFieldMap.delete(removedFieldValue);
        }

        if (movedItem) {
          indexedFieldMap.set(movedItem[indexedField], itemIndex);
        }
      }

      entries.push({
        value,
        removedItem,
        removedIndex: itemIndex,
        movedItem,
        movedFromIndex: movedItem ? lastIndex : null,
      });
    }

    if (entries.length === 0) {
      return;
    }

    this.bumpMutationVersion();
    this.emit({
      type: "removeMany",
      field,
      entries,
    });
  }

  private emit(mutation: StateMutation<T>): void {
    for (const listener of this.listeners) {
      listener(mutation);
    }
  }

  private getOrCreateScope(namespace: string): Map<string, unknown> {
    const existingScope = this.scopedRegistry.get(namespace);

    if (existingScope) {
      return existingScope;
    }

    const nextScope = new Map<string, unknown>();
    this.scopedRegistry.set(namespace, nextScope);
    return nextScope;
  }

  private bumpMutationVersion(): void {
    this.mutationVersion += 1;
    this.clearPreviousResult();
  }

  // First call for a given field triggers O(n) index build; subsequent lookups are O(1).
  private getOrCreateIndexMap(
    field: IndexableKey<T> & string,
  ): Map<any, number> {
    const existingIndexMap = this.indexMaps.get(field);
    if (existingIndexMap) {
      return existingIndexMap;
    }

    return this.rebuildIndexMap(field);
  }

  private rebuildIndexMap(field: IndexableKey<T> & string): Map<any, number> {
    const indexMap = new Map<any, number>();

    for (let itemIndex = 0; itemIndex < this.originData.length; itemIndex++) {
      indexMap.set(this.originData[itemIndex][field], itemIndex);
    }

    this.indexMaps.set(field, indexMap);
    return indexMap;
  }

  private rebuildItemIndexLookup(): void {
    this.itemIndexLookup = new WeakMap<T, number>();

    for (let itemIndex = 0; itemIndex < this.originData.length; itemIndex++) {
      this.itemIndexLookup.set(this.originData[itemIndex], itemIndex);
    }
  }
}
