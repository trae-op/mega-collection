/**
 * @devisfuture/mega-collection/sort — Sort module.
 *
 * Provides high-performance multi-field sorting for 10 M+ rows.
 * Uses V8 TimSort with pre-compiled comparators, and index-sort
 * optimisation for single numeric fields. Fully independent — no
 * dependency on the search or filter modules.
 *
 * @example
 * ```ts
 * import { SortEngine } from '@devisfuture/mega-collection/sort';
 *
 * const sorter = new SortEngine<User>();
 * const sorted = sorter.sort(users, [
 *   { field: 'age', direction: 'asc' },
 *   { field: 'name', direction: 'desc' },
 * ]);
 * ```
 */

export { SortEngine } from "./sorter";

export type { CollectionItem, SortDescriptor, SortDirection } from "../types";
