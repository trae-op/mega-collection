import type { CollectionItem, FilterCriterion } from "../types";
import type { ResolvedFilterCriterion } from "./types";

export function resolveCriteria<T extends CollectionItem>(
  criteria: FilterCriterion<T>[],
): ResolvedFilterCriterion<T>[] {
  const criteriaByField = new Map<string, ResolvedFilterCriterion<T>>();

  for (
    let criterionIndex = 0;
    criterionIndex < criteria.length;
    criterionIndex++
  ) {
    const criterion = criteria[criterionIndex];
    const hasValues = Array.isArray(criterion.values);
    const excludedValues = createUniqueSet(criterion.exclude);
    const hasExclude = excludedValues !== null;

    const includedValues = hasValues
      ? createIncludedValuesSet(criterion.values!, excludedValues)
      : null;

    if (!hasValues && !hasExclude) {
      continue;
    }

    const field = criterion.field as string;
    const existingCriterion = criteriaByField.get(field);

    if (!existingCriterion) {
      criteriaByField.set(field, {
        field: criterion.field,
        values: [],
        exclude: [],
        hasValues,
        hasExclude,
        includedValues: includedValues ? new Set(includedValues) : null,
        excludedValues: excludedValues ? new Set(excludedValues) : null,
        cacheKeySegment: "",
      });
      continue;
    }

    if (hasValues) {
      if (!existingCriterion.hasValues) {
        existingCriterion.hasValues = true;
        existingCriterion.includedValues = new Set(includedValues);
      } else {
        for (const value of existingCriterion.includedValues!) {
          if (!includedValues!.has(value)) {
            existingCriterion.includedValues!.delete(value);
          }
        }
      }
    }

    if (hasExclude) {
      if (!existingCriterion.hasExclude) {
        existingCriterion.hasExclude = true;
        existingCriterion.excludedValues = new Set(excludedValues);
      } else {
        for (const value of excludedValues!) {
          existingCriterion.excludedValues!.add(value);
        }
      }
    }
  }

  const resolvedCriteria = [...criteriaByField.values()].sort((left, right) =>
    (left.field as string).localeCompare(right.field as string),
  );

  for (
    let criterionIndex = 0;
    criterionIndex < resolvedCriteria.length;
    criterionIndex++
  ) {
    finalizeResolvedCriterion(resolvedCriteria[criterionIndex]);
  }

  return resolvedCriteria;
}

export function matchesCriterionValue<T extends CollectionItem>(
  criterion: ResolvedFilterCriterion<T>,
  value: any,
): boolean {
  if (criterion.hasValues && !criterion.includedValues!.has(value)) {
    return false;
  }

  if (criterion.hasExclude && criterion.excludedValues!.has(value)) {
    return false;
  }

  return true;
}

export function isCriterionUnsatisfiable<T extends CollectionItem>(
  criterion: ResolvedFilterCriterion<T>,
): boolean {
  return criterion.hasValues && criterion.values.length === 0;
}

function createUniqueSet(values?: any[]): Set<any> | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  return new Set(values);
}

function createIncludedValuesSet(
  values: any[],
  excludedValues: Set<any> | null,
): Set<any> {
  const includedValues = new Set<any>();

  for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
    const value = values[valueIndex];
    if (excludedValues?.has(value)) {
      continue;
    }

    includedValues.add(value);
  }

  return includedValues;
}

function finalizeResolvedCriterion<T extends CollectionItem>(
  criterion: ResolvedFilterCriterion<T>,
): void {
  if (criterion.hasValues && criterion.hasExclude) {
    for (const value of criterion.excludedValues!) {
      criterion.includedValues!.delete(value);
    }
  }

  criterion.values = criterion.includedValues
    ? [...criterion.includedValues]
    : [];
  criterion.exclude = criterion.excludedValues
    ? [...criterion.excludedValues]
    : [];

  criterion.cacheKeySegment = createCriterionCacheKeySegment(criterion);
}

function createCriterionCacheKeySegment<T extends CollectionItem>(
  criterion: ResolvedFilterCriterion<T>,
): string {
  let segment = criterion.field as string;
  segment += `|hv:${criterion.hasValues ? "1" : "0"}|v:`;

  if (criterion.hasValues) {
    segment += createEncodedValueKey(criterion.values);
  }

  segment += `|hx:${criterion.hasExclude ? "1" : "0"}|x:`;

  if (criterion.hasExclude) {
    segment += createEncodedValueKey(criterion.exclude);
  }

  return segment;
}

function createEncodedValueKey(values: any[]): string {
  if (values.length === 0) {
    return "";
  }

  return values
    .map((value) => encodeCriterionValue(value))
    .sort()
    .join(",");
}

function encodeCriterionValue(value: any): string {
  if (value === null) {
    return "null:null";
  }

  const valueType = typeof value;

  if (valueType === "object") {
    return `object:${JSON.stringify(value)}`;
  }

  return `${valueType}:${String(value)}`;
}
