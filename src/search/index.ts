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
 * // Pass data and fields upfront — no manual buildIndex calls needed.
 * const search = new TextSearchEngine<User>({ data: users, fields: ['name', 'city'] });
 * search.search('john');           // searches all fields, deduplicated
 * search.search('name', 'john');   // searches a single field
 * ```
 */

export { TextSearchEngine } from "./text-search";
export type { TextSearchEngineOptions } from "./text-search";

export type { CollectionItem, IndexableKey } from "../types";
