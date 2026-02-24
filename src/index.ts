/**
 * @devisfuture/mega-collection — public API barrel export.
 *
 * Tree-shakeable: import only the module you need.
 *
 * - `@devisfuture/mega-collection/search` — TextSearchEngine
 * - `@devisfuture/mega-collection/filter`  — FilterEngine
 * - `@devisfuture/mega-collection/sort`    — SortEngine
 */

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
