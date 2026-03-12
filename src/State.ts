import type {
  CollectionItem,
  IndexableKey,
  StateListener,
  StateMutation,
  UpdateDescriptor,
} from "./types";

export class State<T extends CollectionItem> {
  private originData: T[];

  private readonly indexMaps = new Map<
    IndexableKey<T> & string,
    Map<any, number>
  >();

  private readonly listeners = new Set<StateListener<T>>();

  constructor(data: T[] = []) {
    this.originData = data;
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

  data(data: T[]): void {
    this.originData = data;

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
    this.originData.push(...items);

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
    }

    this.originData.pop();

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

  private emit(mutation: StateMutation<T>): void {
    for (const listener of this.listeners) {
      listener(mutation);
    }
  }

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
}
