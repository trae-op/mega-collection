import type { CollectionItem } from "../types";

export interface SortIndex<T> {
  indexes: Uint32Array;
  dataRef: T[];
  itemCount: number;
}

export interface SortEngineOptions<T extends CollectionItem = CollectionItem> {
  data?: T[];

  fields?: (keyof T & string)[];
}

export type SortRuntime<T extends CollectionItem> = {
  indexedFields: Set<keyof T & string>;
  cache: Map<string, SortIndex<T>>;
  dirtyIndexedFields: Set<keyof T & string>;
};
