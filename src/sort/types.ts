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
