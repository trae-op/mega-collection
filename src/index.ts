/**
 * @devisfuture/mega-collection — public API barrel export.
 *
 * Tree-shakeable: import only the module you need.
 *
 * - `@devisfuture/mega-collection/search` — Indexer + TextSearchEngine
 * - `@devisfuture/mega-collection/filter`  — FilterEngine + Indexer
 * - `@devisfuture/mega-collection/sort`    — SortEngine
 */

export { Indexer } from "./indexer";
export { TextSearchEngine } from "./search/text-search";
export { FilterEngine } from "./filter/filter";
export { SortEngine } from "./sort/sorter";

export type {
  CollectionItem,
  FilterCriterion,
  SortDescriptor,
  SortDirection,
  IndexableKey,
} from "./types";
