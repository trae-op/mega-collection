import type { CollectionItem } from "../types";

export interface SortIndex {
  indexes: Uint32Array;
  version: number;
}

export interface SortEngineOptions<T extends CollectionItem = CollectionItem> {
  data?: T[];

  fields?: (keyof T & string)[];
}

export type SortRuntime<T extends CollectionItem> = {
  indexedFields: Set<keyof T & string>;
  cache: Map<string, SortIndex>;
};
