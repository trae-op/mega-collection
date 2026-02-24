/**
 * @devisfuture/mega-collection/sort — Sort module.
 *
 * Provides high-performance multi-field sorting for 10 M+ rows.
 * Use `buildIndex` to pre-compute a sorted index once — all subsequent
 * sorts on that field become O(n) reconstruction instead of O(n log n).
 * Falls back to V8 TimSort with pre-compiled comparators when no index exists.
 *
 * @example
 * ```ts
 * import { SortEngine } from '@devisfuture/mega-collection/sort';
 *
 * // Pass data and fields upfront — no manual buildIndex calls needed.
 * const sorter = new SortEngine<User>({ data: users, fields: ['age', 'name', 'city'] });
 * const sorted = sorter.sort(users, [{ field: 'age', direction: 'asc' }]);
 * ```
 */

export { SortEngine } from "./sorter";
export type { SortEngineOptions } from "./sorter";

export type { CollectionItem, SortDescriptor, SortDirection } from "../types";
