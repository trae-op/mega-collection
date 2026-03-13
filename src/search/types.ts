import type { CollectionItem } from "../types";
import type { SearchNestedCollectionStorage } from "./nested";

export interface TextSearchEngineOptions<
  T extends CollectionItem = CollectionItem,
> {
  data?: T[];

  fields?: (keyof T & string)[];

  nestedFields?: string[];

  minQueryLength?: number;
}

export type NestedFieldDescriptor = {
  collectionKey: string;
  nestedKey: string;
};

export type SearchRuntime<T extends CollectionItem> = {
  indexedFields: Set<keyof T & string>;
  flatIndexes: Map<string, Map<string, Set<number>>>;
  normalizedFieldValues: Map<string, string[]>;
  nestedStorage: SearchNestedCollectionStorage;
};
