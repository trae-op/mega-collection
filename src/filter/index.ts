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
 * const filter = new FilterEngine<User>()
 *   .buildIndex(users, 'city')
 *   .buildIndex(users, 'age');
 *
 * filter.filter(users, [
 *   { field: 'city', values: ['Kyiv', 'Lviv'] },
 *   { field: 'age', values: [25, 30, 35] },
 * ]);
 * ```
 */

export { FilterEngine } from "./filter";

export type { CollectionItem, IndexableKey, FilterCriterion } from "../types";
