import { CollectionItem, FilterCriterion } from "../types";

type NestedFieldDescriptor = {
  collectionKey: string;
  nestedKey: string;
};

export class FilterNestedCollection<T extends CollectionItem> {
  private readonly registeredFields = new Set<string>();

  private readonly fieldDescriptors = new Map<string, NestedFieldDescriptor>();

  private indexes = new Map<string, Map<any, T[]>>();

  registerFields(fieldPaths?: readonly string[]): void {
    if (!fieldPaths?.length) return;

    for (let fieldIndex = 0; fieldIndex < fieldPaths.length; fieldIndex++) {
      this.registerField(fieldPaths[fieldIndex]);
    }
  }

  hasRegisteredFields(): boolean {
    return this.registeredFields.size > 0;
  }

  hasField(fieldPath: string): boolean {
    return this.registeredFields.has(fieldPath);
  }

  clearIndexes(): void {
    this.indexes.clear();
  }

  buildIndexes(data: T[]): void {
    this.indexes.clear();

    for (const fieldPath of this.registeredFields) {
      this.buildIndex(data, fieldPath);
    }
  }

  filter(sourceData: T[], criteria: FilterCriterion<T>[], dataset: T[]): T[] {
    if (sourceData.length === 0 || criteria.length === 0) {
      return sourceData;
    }

    const indexedCriteria: FilterCriterion<T>[] = [];
    const linearCriteria: FilterCriterion<T>[] = [];

    for (
      let criterionIndex = 0;
      criterionIndex < criteria.length;
      criterionIndex++
    ) {
      const criterion = criteria[criterionIndex];
      if (this.indexes.has(criterion.field)) {
        indexedCriteria.push(criterion);
        continue;
      }

      linearCriteria.push(criterion);
    }

    let result = sourceData;
    const allowedItems = sourceData === dataset ? null : new Set(sourceData);

    if (indexedCriteria.length > 0) {
      result = this.filterByIndexes(indexedCriteria, allowedItems);
      if (result.length === 0) return result;
    }

    for (
      let criterionIndex = 0;
      criterionIndex < linearCriteria.length;
      criterionIndex++
    ) {
      result = this.filterLinearly(result, linearCriteria[criterionIndex]);
      if (result.length === 0) return result;
    }

    return result;
  }

  private registerField(fieldPath: string): void {
    const descriptor = this.createDescriptor(fieldPath);
    if (!descriptor) return;

    this.registeredFields.add(fieldPath);
    this.fieldDescriptors.set(fieldPath, descriptor);
  }

  private createDescriptor(fieldPath: string): NestedFieldDescriptor | null {
    const dotIndex = fieldPath.indexOf(".");
    if (dotIndex === -1) return null;

    return {
      collectionKey: fieldPath.substring(0, dotIndex),
      nestedKey: fieldPath.substring(dotIndex + 1),
    };
  }

  private buildIndex(data: T[], fieldPath: string): void {
    const descriptor = this.fieldDescriptors.get(fieldPath);
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
          continue;
        }

        indexMap.set(value, [item]);
      }
    }

    this.indexes.set(fieldPath, indexMap);
  }

  private filterByIndexes(
    criteria: FilterCriterion<T>[],
    allowedItems: Set<T> | null,
  ): T[] {
    if (criteria.length === 1) {
      const nestedIndex = this.indexes.get(criteria[0].field);
      if (!nestedIndex) return [];

      const matchingItems = this.getItemsByValues(
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
        size: this.estimateIndexSize(criterion),
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
      const nestedIndex = this.indexes.get(criterion.field);

      if (!nestedIndex) return [];

      const nextMatchingItems = this.getItemsByValues(
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

      currentAllowedItems = new Set(matchingItems);
    }

    return matchingItems;
  }

  private getItemsByValues(indexMap: Map<any, T[]>, values: any[]): T[] {
    if (values.length === 1) {
      return indexMap.get(values[0]) ?? [];
    }

    const seenItems = new Set<T>();
    const result: T[] = [];

    for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
      const bucket = indexMap.get(values[valueIndex]);
      if (!bucket) continue;

      for (let itemIndex = 0; itemIndex < bucket.length; itemIndex++) {
        const item = bucket[itemIndex];
        if (seenItems.has(item)) continue;

        seenItems.add(item);
        result.push(item);
      }
    }

    return result;
  }

  private estimateIndexSize(criterion: FilterCriterion<T>): number {
    const indexMap = this.indexes.get(criterion.field);
    if (!indexMap) return Infinity;

    return criterion.values.reduce((totalSize, value) => {
      const bucket = indexMap.get(value);
      return bucket ? totalSize + bucket.length : totalSize;
    }, 0);
  }

  private filterLinearly(data: T[], criterion: FilterCriterion<T>): T[] {
    const descriptor = this.fieldDescriptors.get(criterion.field);
    if (!descriptor) return data;

    const { collectionKey, nestedKey } = descriptor;
    const acceptableValues = new Set(criterion.values);
    const result: T[] = [];

    for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
      const item = data[itemIndex];
      const collection = item[collectionKey];
      if (!Array.isArray(collection)) continue;

      let hasMatch = false;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        if (!acceptableValues.has(collection[nestedIndex][nestedKey])) continue;

        hasMatch = true;
        break;
      }

      if (hasMatch) {
        result.push(item);
      }
    }

    return result;
  }
}
