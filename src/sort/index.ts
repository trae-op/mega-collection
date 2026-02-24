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
 * // With index: first sort O(n log n), every repeat O(n)
 * const sorter = new SortEngine<User>().buildIndex(users, 'age');
 * const sorted = sorter.sort(users, [{ field: 'age', direction: 'asc' }]);
 *
 * // Without index: always O(n log n)
 * const sorter = new SortEngine<User>();
 * const sorted = sorter.sort(users, [
 *   { field: 'age', direction: 'asc' },
 *   { field: 'name', direction: 'desc' },
 * ]);
 * ```
 */

export { SortEngine } from "./sorter";

export type { CollectionItem, SortDescriptor, SortDirection } from "../types";
