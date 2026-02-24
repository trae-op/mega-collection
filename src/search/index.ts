/**
 * @devisfuture/mega-collection/search — Search module.
 *
 * Provides high-performance trigram-accelerated text search.
 * Can be used independently of the filter and sort modules.
 *
 * @example
 * ```ts
 * import { TextSearchEngine } from '@devisfuture/mega-collection/search';
 *
 * const search = new TextSearchEngine<User>();
 * search.buildIndex(users, 'name');
 * search.search('name', 'john');
 * ```
 */

export { TextSearchEngine } from "./text-search";

export type { CollectionItem, IndexableKey } from "../types";
