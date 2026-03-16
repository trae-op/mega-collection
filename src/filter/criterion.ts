import type { CollectionItem, FilterCriterion } from "../types";
import type { ResolvedFilterCriterion } from "./types";

export function resolveCriteria<T extends CollectionItem>(
  criteria: FilterCriterion<T>[],
): ResolvedFilterCriterion<T>[] {
  const resolvedCriteria: ResolvedFilterCriterion<T>[] = [];

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

    resolvedCriteria.push({
      field: criterion.field,
      values: includedValues ? [...includedValues] : [],
      exclude: excludedValues ? [...excludedValues] : [],
      hasValues,
      hasExclude,
      includedValues,
      excludedValues,
    });
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
