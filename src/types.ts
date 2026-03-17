export type CollectionItem = Record<string, any>;

export type IndexableKey<T> = {
  [K in keyof T]: T[K] extends string | number ? K : never;
}[keyof T];

export interface UpdateDescriptor<T extends CollectionItem> {
  field: IndexableKey<T> & string;
  data: T;
}

export interface FilterCriterion<T extends CollectionItem> {
  field: (keyof T & string) | (string & {});
  values?: any[];
  exclude?: any[];
}

export type SortDirection = "asc" | "desc";

export interface SortDescriptor<T extends CollectionItem> {
  field: keyof T & string;
  direction: SortDirection;
}

export type StateListener<T extends CollectionItem> = (
  mutation: StateMutation<T>,
) => void;

export interface StateRegistryFactory<TValue> {
  (): TValue;
}

export interface StateOptions {
  filterByPreviousResult?: boolean;
}

export interface StatePreviousResult<T extends CollectionItem> {
  result: T[];
  sourceData: T[];
  version: number;
}

export type StateAddMutation<T extends CollectionItem> = {
  type: "add";
  items: T[];
  startIndex: number;
};

export type StateUpdateMutation<T extends CollectionItem> = {
  type: "update";
  field: IndexableKey<T> & string;
  index: number;
  previousItem: T;
  nextItem: T;
};

export type StateDataMutation<T extends CollectionItem> = {
  type: "data";
  data: T[];
};

export type StateClearMutation<T extends CollectionItem> = {
  type: "clearData";
  data: T[];
};

export type StateRemoveMutation<T extends CollectionItem> = {
  type: "remove";
  field: IndexableKey<T> & string;
  value: T[IndexableKey<T> & string];
  removedItem: T;
  removedIndex: number;
  movedItem: T | null;
  movedFromIndex: number | null;
};

export type StateRemoveManyEntry<T extends CollectionItem> = {
  value: T[IndexableKey<T> & string];
  removedItem: T;
  removedIndex: number;
  movedItem: T | null;
  movedFromIndex: number | null;
};

export type StateRemoveManyMutation<T extends CollectionItem> = {
  type: "removeMany";
  field: IndexableKey<T> & string;
  entries: StateRemoveManyEntry<T>[];
};

export type StateMutation<T extends CollectionItem> =
  | StateAddMutation<T>
  | StateUpdateMutation<T>
  | StateDataMutation<T>
  | StateClearMutation<T>
  | StateRemoveMutation<T>
  | StateRemoveManyMutation<T>;
