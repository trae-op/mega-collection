/**
 * MergeEngines — unified facade that composes TextSearchEngine, SortEngine
 * and FilterEngine into a single entry point.
 *
 * Design:
 *  - The `imports` array declares which sub-engines to activate.
 *  - Each sub-engine is initialised lazily only when its constructor appears
 *    in `imports` AND the corresponding config section is provided.
 *  - Delegates `search`, `sort` and `filter` calls directly to the underlying
 *    engines — zero logic duplication.
 *
 * @example
 * ```ts
 * import { MergeEngines } from "@devisfuture/mega-collection";
 * import { TextSearchEngine } from "@devisfuture/mega-collection/search";
 * import { SortEngine }       from "@devisfuture/mega-collection/sort";
 * import { FilterEngine }     from "@devisfuture/mega-collection/filter";
 *
 * const engine = new MergeEngines<User>({
 *   imports: [TextSearchEngine, SortEngine, FilterEngine],
 *   data: users,
 *   search: { fields: ["city", "name"], minQueryLength: 2 },
 *   filter: { fields: ["city", "age"] },
 *   sort:   { fields: ["age", "name", "city"] },
 * });
 *
 * engine.search("john");
 * engine.sort([{ field: "age", direction: "asc" }]);
 * engine.filter([{ field: "city", values: ["Kyiv"] }]);
 * ```
 */

import {
  TextSearchEngine,
  type TextSearchEngineOptions,
} from "../search/text-search";
import { SortEngine } from "../sort/sorter";
import { FilterEngine } from "../filter/filter";
import type { CollectionItem, FilterCriterion, SortDescriptor } from "../types";

// ---------------------------------------------------------------------------
// Config sub-types (only the fields that MergeEngines needs from the caller;
// `data` is hoisted to the top-level option and shared across engines).
// ---------------------------------------------------------------------------

/** Search-specific configuration (excludes `data` — shared at the top level). */
export interface MergeSearchConfig<T extends CollectionItem> {
  fields: (keyof T & string)[];
  minQueryLength?: TextSearchEngineOptions<T>["minQueryLength"];
}

/** Filter-specific configuration (excludes `data` — shared at the top level). */
export interface MergeFilterConfig<T extends CollectionItem> {
  fields: (keyof T & string)[];
  filterByPreviousResult?: boolean;
}

/** Sort-specific configuration (excludes `data` — shared at the top level). */
export interface MergeSortConfig<T extends CollectionItem> {
  fields: (keyof T & string)[];
}

// ---------------------------------------------------------------------------
// Engine constructor type — any of the three supported engine classes.
// ---------------------------------------------------------------------------

/** Union of the three engine constructors accepted in `imports`. */
export type EngineConstructor =
  | typeof TextSearchEngine
  | typeof SortEngine
  | typeof FilterEngine;

// ---------------------------------------------------------------------------
// MergeEngines options
// ---------------------------------------------------------------------------

export interface MergeEnginesOptions<T extends CollectionItem> {
  /**
   * List of engine classes to activate.
   * Only engines present in this array will be initialised.
   *
   * @example
   * ```ts
   * imports: [TextSearchEngine, SortEngine, FilterEngine]
   * ```
   */
  imports: EngineConstructor[];

  /** Shared dataset — passed to every activated engine. */
  data: T[];

  /** Config for TextSearchEngine (requires `TextSearchEngine` in `imports`). */
  search?: MergeSearchConfig<T>;

  /** Config for FilterEngine (requires `FilterEngine` in `imports`). */
  filter?: MergeFilterConfig<T>;

  /** Config for SortEngine (requires `SortEngine` in `imports`). */
  sort?: MergeSortConfig<T>;
}

// ---------------------------------------------------------------------------
// MergeEngines class
// ---------------------------------------------------------------------------

export class MergeEngines<T extends CollectionItem> {
  private readonly searchEngine: TextSearchEngine<T> | null;
  private readonly sortEngine: SortEngine<T> | null;
  private readonly filterEngine: FilterEngine<T> | null;

  constructor(options: MergeEnginesOptions<T>) {
    const { imports, data, search, filter, sort } = options;

    // Build a Set for O(1) membership checks instead of repeated Array.includes.
    const importedEngines = new Set<EngineConstructor>(imports);

    const hasSearchImport = importedEngines.has(TextSearchEngine);
    const hasSortImport = importedEngines.has(SortEngine);
    const hasFilterImport = importedEngines.has(FilterEngine);

    // --- Initialise only the engines declared in `imports` ----------------

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

  // -----------------------------------------------------------------------
  // Public API — thin delegates to the underlying engines
  // -----------------------------------------------------------------------

  /**
   * Search items by substring across all indexed fields.
   *
   * Delegates to `TextSearchEngine.search`.
   *
   * @throws {Error} If `TextSearchEngine` was not included in `imports`.
   */
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

  /**
   * Sort items by one or more fields.
   *
   * Delegates to `SortEngine.sort`.
   * Uses the shared dataset from the constructor when called without `data`.
   *
   * @throws {Error} If `SortEngine` was not included in `imports`.
   */
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

  /**
   * Filter items by multiple criteria (AND logic).
   *
   * Delegates to `FilterEngine.filter`.
   * Uses the shared dataset from the constructor when called without `data`.
   *
   * @throws {Error} If `FilterEngine` was not included in `imports`.
   */
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

  // -----------------------------------------------------------------------
  // Accessors — direct access to sub-engines when advanced API is needed
  // -----------------------------------------------------------------------

  /** Returns the underlying TextSearchEngine, or `null` if not imported. */
  getSearchEngine(): TextSearchEngine<T> | null {
    return this.searchEngine;
  }

  /** Returns the underlying SortEngine, or `null` if not imported. */
  getSortEngine(): SortEngine<T> | null {
    return this.sortEngine;
  }

  /** Returns the underlying FilterEngine, or `null` if not imported. */
  getFilterEngine(): FilterEngine<T> | null {
    return this.filterEngine;
  }
}
