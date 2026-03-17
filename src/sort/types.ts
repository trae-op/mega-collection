import type { CollectionItem } from "../types";

export interface SortIndex<T extends CollectionItem = CollectionItem> {
  indexes: Uint32Array;
  reverseIndex: Uint32Array;
  ascItems: T[] | null;
  descItems: T[] | null;
  hasDuplicateValues: boolean;
  version: number;
}

export interface SortEngineOptions<T extends CollectionItem = CollectionItem> {
  data?: T[];

  fields?: (keyof T & string)[];
}

export type SortRuntime<T extends CollectionItem> = {
  indexedFields: Set<keyof T & string>;
  cache: Map<string, SortIndex<T>>;
};
