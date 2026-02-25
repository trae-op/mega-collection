/**
 * @devisfuture/mega-collection/merge — Unified engine module.
 *
 * Combines TextSearchEngine, SortEngine and FilterEngine behind a single
 * `MergeEngines` facade so all three can share the same dataset and be
 * configured in one constructor call.
 *
 * @example
 * ```ts
 * import { MergeEngines }      from '@devisfuture/mega-collection';
 * import { TextSearchEngine }  from '@devisfuture/mega-collection/search';
 * import { SortEngine }        from '@devisfuture/mega-collection/sort';
 * import { FilterEngine }      from '@devisfuture/mega-collection/filter';
 *
 * const engine = new MergeEngines<User>({
 *   imports: [TextSearchEngine, SortEngine, FilterEngine],
 *   data: users,
 *   search: { fields: ['name', 'city'], minQueryLength: 2 },
 *   filter: { fields: ['city', 'age'] },
 *   sort:   { fields: ['age', 'name', 'city'] },
 * });
 *
 * engine.search('john');
 * engine.sort(users, [{ field: 'age', direction: 'asc' }]);
 * engine.filter(users, [{ field: 'city', values: ['Kyiv'] }]);
 * ```
 */

export { MergeEngines } from "./merge-engines";
export type {
  MergeEnginesOptions,
  MergeSearchConfig,
  MergeFilterConfig,
  MergeSortConfig,
  EngineConstructor,
} from "./merge-engines";

export type {
  CollectionItem,
  IndexableKey,
  FilterCriterion,
  SortDescriptor,
  SortDirection,
} from "../types";
