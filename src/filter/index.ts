/**
 * @devisfuture/mega-collection/filter — Filter module.
 *
 * Provides multi-criteria AND filtering optimised for 10 M+ rows.
 * Uses hash-map indexes (from Indexer) for the fast path, or falls back
 * to a linear scan with Set-based membership tests.
 *
 * @example
 * ```ts
 * import { FilterEngine } from '@devisfuture/mega-collection/filter';
 * import { Indexer } from '@devisfuture/mega-collection/search';
 *
 * const indexer = new Indexer<User>();
 * indexer.buildIndex(users, 'city');
 * indexer.buildIndex(users, 'age');
 *
 * const filter = new FilterEngine<User>(indexer);
 * filter.filter(users, [
 *   { field: 'city', values: ['Kyiv', 'Lviv'] },
 *   { field: 'age', values: [25, 30, 35] },
 * ]);
 * ```
 */

export { FilterEngine } from "./filter";
export { Indexer } from "../indexer";

export type { CollectionItem, IndexableKey, FilterCriterion } from "../types";
