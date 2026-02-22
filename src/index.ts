/**
 * mega-collection — public API barrel export.
 *
 * This is the main entry point for the npm package.
 */

export { MegaCollection } from "./mega-collection";
export { Indexer } from "./indexer";
export { TextSearchEngine } from "./text-search";
export { FilterEngine } from "./filter";
export { SortEngine } from "./sorter";

export type {
  CollectionItem,
  MegaCollectionConfig,
  FilterCriterion,
  SortDescriptor,
  SortDirection,
  TextSearchOptions,
  IndexableKey,
} from "./types";
