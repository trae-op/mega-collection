export type CollectionItem = Record<string, any>;

export type IndexableKey<T> = {
  [K in keyof T]: T[K] extends string | number ? K : never;
}[keyof T];

export interface FilterCriterion<T extends CollectionItem> {
  field: (keyof T & string) | (string & {});
  values: any[];
}

export type SortDirection = "asc" | "desc";

export interface SortDescriptor<T extends CollectionItem> {
  field: keyof T & string;
  direction: SortDirection;
}
