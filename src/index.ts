/**
 * @devisfuture/mega-collection — public API barrel export.
 *
 * This is the main entry point for the npm package.
 * Re-exports everything from all sub-modules for convenience.
 */

export { MegaCollection } from "./mega-collection";
export { Indexer } from "./indexer";
export { TextSearchEngine } from "./search/text-search";
export { FilterEngine } from "./filter/filter";
export { SortEngine } from "./sort/sorter";

export type {
  CollectionItem,
  MegaCollectionConfig,
  FilterCriterion,
  SortDescriptor,
  SortDirection,
  IndexableKey,
} from "./types";
