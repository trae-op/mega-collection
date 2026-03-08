import type { CollectionItem } from "../types";

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
