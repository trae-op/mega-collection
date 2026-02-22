/**
 * @devisfuture/mega-collection/search — Search module.
 *
 * Provides high-performance text search (trigram-accelerated) and O(1) exact
 * key lookups via hash-map indexes. Can be used independently of the filter
 * and sort modules.
 *
 * @example
 * ```ts
 * import { Indexer, TextSearchEngine } from '@devisfuture/mega-collection/search';
 *
 * const indexer = new Indexer<User>();
 * indexer.buildIndex(users, 'city');
 * indexer.getByValue('city', 'Kyiv'); // O(1)
 *
 * const search = new TextSearchEngine<User>();
 * search.buildIndex(users, 'name');
 * search.search('name', 'john');
 * ```
 */

export { Indexer } from "../indexer";
export { TextSearchEngine } from "./text-search";

export type { CollectionItem, IndexableKey } from "../types";
