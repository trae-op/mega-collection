/**
 * MegaCollection — the main API facade.
 *
 * Combines Indexer, TextSearchEngine, FilterEngine and SortEngine into a
 * single cohesive class that manages a 10 M+ item collection with blazing-fast
 * search, filter and sort capabilities.
 *
 * Usage:
 * ```ts
 * import { MegaCollection } from "mega-collection";
 *
 * interface User {
 *   id: number;
 *   name: string;
 *   city: string;
 *   age: number;
 * }
 *
 * const mc = new MegaCollection<User>({
 *   indexFields: ["city", "age"],
 *   textSearchFields: ["name"],
 * });
 *
 * mc.load(tenMillionUsers);
 *
 * // O(1) exact lookup
 * mc.exactLookup("city", "Kyiv");
 *
 * // Trigram-accelerated text search
 * mc.textSearch("name", "john", { mode: "contains", limit: 100 });
 *
 * // Multi-criteria filter (AND logic)
 * mc.filter([
 *   { field: "city", values: ["Kyiv", "Lviv"] },
 *   { field: "age",  values: [25, 30, 35] },
 * ]);
 *
 * // Multi-field sort
 * mc.sort([{ field: "age", direction: "asc" }, { field: "name", direction: "desc" }]);
 * ```
 */

import {
  CollectionItem,
  MegaCollectionConfig,
  FilterCriterion,
  SortDescriptor,
  TextSearchOptions,
} from "./types";
import { Indexer } from "./indexer";
import { TextSearchEngine } from "./text-search";
import { FilterEngine } from "./filter";
import { SortEngine } from "./sorter";

export class MegaCollection<T extends CollectionItem> {
  private data: T[] = [];
  private config: MegaCollectionConfig<T>;
  private indexer: Indexer<T>;
  private textEngine: TextSearchEngine<T>;
  private filterEngine: FilterEngine<T>;
  private sortEngine: SortEngine<T>;

  constructor(config: MegaCollectionConfig<T> = {}) {
    this.config = config;
    this.indexer = new Indexer<T>();
    this.textEngine = new TextSearchEngine<T>();
    this.filterEngine = new FilterEngine<T>(this.indexer);
    this.sortEngine = new SortEngine<T>();
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Data management
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Load data and build all configured indexes.
   * Call this once with the full dataset. O(n) for hash indexes, O(n·L) for
   * trigram indexes.
   */
  load(data: T[]): void {
    this.data = data;
    this.buildIndexes();
  }

  /** Get the raw dataset reference. */
  getData(): T[] {
    return this.data;
  }

  /** Get the current collection size. */
  get size(): number {
    return this.data.length;
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Indexing
  // ────────────────────────────────────────────────────────────────────────

  /** Rebuild all configured indexes. */
  buildIndexes(): void {
    this.indexer.clear();
    this.textEngine.clear();

    if (this.config.indexFields) {
      for (const field of this.config.indexFields) {
        this.indexer.buildIndex(this.data, field);
      }
    }

    if (this.config.textSearchFields) {
      for (const field of this.config.textSearchFields) {
        this.textEngine.buildIndex(this.data, field);
      }
    }
  }

  /**
   * Add a hash-map index for a field at runtime.
   * Useful when you discover new filtering needs after initial load.
   */
  addIndex(field: keyof T & string): void {
    if (!this.config.indexFields) this.config.indexFields = [];
    if (!this.config.indexFields.includes(field)) {
      this.config.indexFields.push(field);
    }
    this.indexer.buildIndex(this.data, field);
  }

  /**
   * Add a trigram text-search index for a field at runtime.
   */
  addTextIndex(field: keyof T & string): void {
    if (!this.config.textSearchFields) this.config.textSearchFields = [];
    if (!this.config.textSearchFields.includes(field)) {
      this.config.textSearchFields.push(field);
    }
    this.textEngine.buildIndex(this.data, field);
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Search
  // ────────────────────────────────────────────────────────────────────────

  /**
   * O(1) exact-value lookup using the hash-map index.
   * The field MUST have been indexed via `indexFields` config or `addIndex()`.
   */
  exactLookup(field: keyof T & string, value: any): T[] {
    return this.indexer.getByValue(field, value);
  }

  /**
   * Multi-value exact lookup: return items where `item[field]` is in `values`.
   * Equivalent to SQL `WHERE field IN (v1, v2, …)`.
   */
  exactLookupMulti(field: keyof T & string, values: any[]): T[] {
    return this.indexer.getByValues(field, values);
  }

  /**
   * Text search using the trigram index.
   * Supports "contains", "prefix" and "exact" modes.
   * The field MUST have been indexed via `textSearchFields` or `addTextIndex()`.
   */
  textSearch(
    field: keyof T & string,
    query: string,
    options?: TextSearchOptions,
  ): T[] {
    return this.textEngine.search(field, query, options);
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Filter
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Multi-criteria filter with AND logic.
   * Each criterion: `{ field, values }` — item passes if its field value is
   * in the `values` array.  Uses hash-map indexes when available, otherwise
   * falls back to linear scan with Set-based membership test.
   */
  filter(criteria: FilterCriterion<T>[]): T[] {
    return this.filterEngine.filter(this.data, criteria);
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Sort
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Sort items by one or more fields.
   * Uses index-sort for single numeric fields, otherwise V8 TimSort with
   * a pre-compiled comparator.
   *
   * @param descriptors - Array of {field, direction} objects.
   * @param inPlace     - If true, mutates `this.data`. Default false.
   * @returns Sorted array.
   */
  sort(descriptors: SortDescriptor<T>[], inPlace = false): T[] {
    return this.sortEngine.sort(this.data, descriptors, inPlace);
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Utilities
  // ────────────────────────────────────────────────────────────────────────

  /** Free all index memory. Data array is kept. */
  clearIndexes(): void {
    this.indexer.clear();
    this.textEngine.clear();
  }

  /** Remove all data and indexes. */
  destroy(): void {
    this.data = [];
    this.clearIndexes();
  }
}
