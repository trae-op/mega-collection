/**
 * Core type definitions for MegaCollection.
 *
 * All generics use `T` for the item type and constrain it to `Record<string, any>`
 * so that every item is an indexable plain object.
 */

/** Any plain object whose values can be indexed. */
export type CollectionItem = Record<string, any>;

/**
 * Extract only the keys of T whose values are `string | number`.
 * Used to restrict indexing / sorting to primitive-comparable fields.
 */
export type IndexableKey<T> = {
  [K in keyof T]: T[K] extends string | number ? K : never;
}[keyof T];

/** Configuration passed when creating a MegaCollection instance. */
export interface MegaCollectionConfig<T extends CollectionItem> {
  /**
   * Fields to build hash-map indexes on (for O(1) exact lookups).
   * Each field gets its own `Map<value, T[]>`.
   */
  indexFields?: (keyof T & string)[];

  /**
   * Fields to build trigram indexes on (for fast substring / fuzzy text search).
   * Only string fields make sense here.
   */
  textSearchFields?: (keyof T & string)[];
}

/** A single filter criterion: field name → set of acceptable values. */
export interface FilterCriterion<T extends CollectionItem> {
  field: keyof T & string;
  values: any[];
}

/** Sorting direction. */
export type SortDirection = "asc" | "desc";

/** Sorting descriptor. */
export interface SortDescriptor<T extends CollectionItem> {
  field: keyof T & string;
  direction: SortDirection;
}
