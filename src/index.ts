export { TextSearchEngine } from "./search/text-search";
export { FilterEngine } from "./filter/filter";
export { SortEngine } from "./sort/sorter";
export { MergeEngines } from "./merge/merge-engines";

export type {
  MergeEnginesOptions,
  EngineApi,
  EngineConstructor,
} from "./merge/merge-engines";

export type {
  CollectionItem,
  FilterCriterion,
  SortDescriptor,
  SortDirection,
  IndexableKey,
} from "./types";
