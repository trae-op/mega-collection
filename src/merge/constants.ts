export const DEFER_SORT_MUTATION_CACHE_UPDATES_KEY =
  "deferSortMutationCacheUpdates";

export const DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY =
  "deferSearchMutationIndexUpdates";

export const DEFER_FILTER_MUTATION_INDEX_UPDATES_KEY =
  "deferFilterMutationIndexUpdates";

export const MODULE_TO_ENGINE = {
  search: "TextSearchEngine",
  sort: "SortEngine",
  filter: "FilterEngine",
} as const;
