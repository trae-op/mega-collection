/**
 * @devisfuture/mega-collection/filter — Filter module.
 *
 * Provides multi-criteria AND filtering optimised for 10 M+ rows.
 * Build indexes directly on FilterEngine for the O(1) fast path, or skip
 * buildIndex to fall back to a linear scan with Set-based membership tests.
 *
 * @example
 * ```ts
 * import { FilterEngine } from '@devisfuture/mega-collection/filter';
 *
 * // Pass data and fields upfront — no manual buildIndex calls needed.
 * const filter = new FilterEngine<User>({ data: users, fields: ['city', 'age'] });
 *
 * filter.filter(users, [
 *   { field: 'city', values: ['Kyiv', 'Lviv'] },
 *   { field: 'age', values: [25, 30, 35] },
 * ]);
 * ```
 */

export { FilterEngine } from "./filter";
export type { FilterEngineOptions } from "./filter";

export type { CollectionItem, IndexableKey, FilterCriterion } from "../types";
