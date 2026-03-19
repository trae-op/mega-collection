import type { CollectionItem, IndexableKey } from "./types";

export function createChainMethodDescriptor<TValue>(
  value: TValue,
): PropertyDescriptor {
  return {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  };
}

export function createNestedFieldDescriptor(fieldPath: string): {
  collectionKey: string;
  nestedKey: string;
} | null {
  const dotIndex = fieldPath.indexOf(".");
  if (dotIndex === -1) {
    return null;
  }

  return {
    collectionKey: fieldPath.substring(0, dotIndex),
    nestedKey: fieldPath.substring(dotIndex + 1),
  };
}

export function normalizeDeleteValues<TValue>(
  valueOrValues: TValue | TValue[],
): TValue[] {
  return Array.isArray(valueOrValues) ? valueOrValues : [valueOrValues];
}

export function findDuplicateDeleteValues<T extends CollectionItem>(
  data: T[],
  field: IndexableKey<T> & string,
  values: ReadonlyArray<T[IndexableKey<T> & string]>,
): Array<T[IndexableKey<T> & string]> {
  if (values.length === 0 || data.length === 0) {
    return [];
  }

  const requestedValues = new Set(values);
  const seenValues = new Set<T[IndexableKey<T> & string]>();
  const duplicateValues = new Set<T[IndexableKey<T> & string]>();

  for (let itemIndex = 0; itemIndex < data.length; itemIndex++) {
    const fieldValue = data[itemIndex][field] as T[IndexableKey<T> & string];

    if (!requestedValues.has(fieldValue)) {
      continue;
    }

    if (seenValues.has(fieldValue)) {
      duplicateValues.add(fieldValue);
      continue;
    }

    seenValues.add(fieldValue);
  }

  return Array.from(duplicateValues);
}

export function createNonUniqueDeleteErrorMessage(
  engineName: string,
  field: string,
  duplicateValues: readonly unknown[],
): string {
  const renderedValues = duplicateValues
    .map((value) => JSON.stringify(value))
    .join(", ");
  const label = duplicateValues.length === 1 ? "value" : "values";

  return `${engineName}: delete() requires unique field values. Field \`${field}\` matched multiple items for ${label} ${renderedValues}.`;
}
