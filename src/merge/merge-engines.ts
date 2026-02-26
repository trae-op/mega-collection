/**
 * MergeEngines class that provides a unified interface for text search,
 * sorting, and filtering operations on collections.
 */

import {
  TextSearchEngine,
  type TextSearchEngineOptions,
} from "../search/text-search";
import { SortEngine } from "../sort/sorter";
import { FilterEngine } from "../filter/filter";
import type { CollectionItem, FilterCriterion, SortDescriptor } from "../types";

export interface MergeSearchConfig<T extends CollectionItem> {
  fields: (keyof T & string)[];
  minQueryLength?: TextSearchEngineOptions<T>["minQueryLength"];
}

export interface MergeFilterConfig<T extends CollectionItem> {
  fields: (keyof T & string)[];
  filterByPreviousResult?: boolean;
}

export interface MergeSortConfig<T extends CollectionItem> {
  fields: (keyof T & string)[];
}

export type EngineConstructor =
  | typeof TextSearchEngine
  | typeof SortEngine
  | typeof FilterEngine;

export interface MergeEnginesOptions<T extends CollectionItem> {
  imports: EngineConstructor[];

  data: T[];

  search?: MergeSearchConfig<T>;

  filter?: MergeFilterConfig<T>;

  sort?: MergeSortConfig<T>;
}

export class MergeEngines<T extends CollectionItem> {
  private readonly searchEngine: TextSearchEngine<T> | null;
  private readonly sortEngine: SortEngine<T> | null;
  private readonly filterEngine: FilterEngine<T> | null;

  constructor(options: MergeEnginesOptions<T>) {
    const { imports, data, search, filter, sort } = options;

    const importedEngines = new Set<EngineConstructor>(imports);

    const hasSearchImport = importedEngines.has(TextSearchEngine);
    const hasSortImport = importedEngines.has(SortEngine);
    const hasFilterImport = importedEngines.has(FilterEngine);

    this.searchEngine = hasSearchImport
      ? new TextSearchEngine<T>({
          data,
          fields: search?.fields,
          minQueryLength: search?.minQueryLength,
        })
      : null;

    this.sortEngine = hasSortImport
      ? new SortEngine<T>({
          data,
          fields: sort?.fields,
        })
      : null;

    this.filterEngine = hasFilterImport
      ? new FilterEngine<T>({
          data,
          fields: filter?.fields,
          filterByPreviousResult: filter?.filterByPreviousResult,
        })
      : null;
  }

  search(query: string): T[];
  search(field: keyof T & string, query: string): T[];
  search(fieldOrQuery: string, maybeQuery?: string): T[] {
    if (!this.searchEngine) {
      throw new Error(
        "MergeEngines: TextSearchEngine is not available. " +
          "Add TextSearchEngine to the `imports` array.",
      );
    }

    if (maybeQuery === undefined) {
      return this.searchEngine.search(fieldOrQuery);
    }

    return this.searchEngine.search(
      fieldOrQuery as keyof T & string,
      maybeQuery,
    );
  }

  sort(descriptors: SortDescriptor<T>[]): T[];
  sort(data: T[], descriptors: SortDescriptor<T>[], inPlace?: boolean): T[];
  sort(
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] {
    if (!this.sortEngine) {
      throw new Error(
        "MergeEngines: SortEngine is not available. " +
          "Add SortEngine to the `imports` array.",
      );
    }

    if (descriptors === undefined) {
      return this.sortEngine.sort(dataOrDescriptors as SortDescriptor<T>[]);
    }

    return this.sortEngine.sort(dataOrDescriptors as T[], descriptors, inPlace);
  }

  filter(criteria: FilterCriterion<T>[]): T[];
  filter(data: T[], criteria: FilterCriterion<T>[]): T[];
  filter(
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ): T[] {
    if (!this.filterEngine) {
      throw new Error(
        "MergeEngines: FilterEngine is not available. " +
          "Add FilterEngine to the `imports` array.",
      );
    }

    if (criteria === undefined) {
      return this.filterEngine.filter(dataOrCriteria as FilterCriterion<T>[]);
    }

    return this.filterEngine.filter(dataOrCriteria as T[], criteria);
  }
}
