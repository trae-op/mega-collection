export { TextSearchEngine } from "./search/text-search";
export { FilterEngine } from "./filter/filter";
export { SortEngine } from "./sort/sorter";
export { MergeEngines } from "./merge";

export type {
  MergeEnginesOptions,
  EngineApi,
  EngineConstructor,
  MergeEnginesChain,
  MergeModuleName,
} from "./merge";

export type {
  CollectionItem,
  FilterCriterion,
  SortDescriptor,
  SortDirection,
  IndexableKey,
} from "./types";
