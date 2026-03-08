import type { CollectionItem, SortDescriptor } from "../types";
import type { SortEngine } from "./sorter";

export interface SortIndex<T> {
  indexes: Uint32Array;
  dataRef: T[];
  itemCount: number;
  fieldSnapshot: unknown[];
}

export interface SortEngineOptions<T extends CollectionItem = CollectionItem> {
  data?: T[];

  fields?: (keyof T & string)[];
}

export interface SortEngineChain<T extends CollectionItem> {
  sort(descriptors: SortDescriptor<T>[]): T[] & SortEngineChain<T>;
  sort(
    data: T[],
    descriptors: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] & SortEngineChain<T>;
  getOriginData(): T[];
  data(data: T[]): SortEngine<T>;
  clearIndexes(): SortEngine<T>;
  clearData(): SortEngine<T>;
}

export type SortEngineChainCallbacks<T extends CollectionItem> = {
  sort: (
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace?: boolean,
  ) => T[] & SortEngineChain<T>;
  getOriginData: () => T[];
  data: (data: T[]) => SortEngine<T>;
  clearIndexes: () => SortEngine<T>;
  clearData: () => SortEngine<T>;
};