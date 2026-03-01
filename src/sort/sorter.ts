/**
 * SortEngine class for sorting large datasets using pre-built indexes
 * for O(n) performance or fallback to in-place sorting.
 */

import { CollectionItem, SortDescriptor, SortDirection } from "../types";

interface SortIndex<T> {
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
  clearIndexes(): SortEngine<T>;
  clearData(): SortEngine<T>;
}

export class SortEngine<T extends CollectionItem> {
  private cache = new Map<string, SortIndex<T>>();

  private data: T[] = [];

  /**
   * Creates a new SortEngine with optional data and fields to index.
   */
  constructor(options: SortEngineOptions<T> = {}) {
    if (!options.data) return;

    this.data = options.data;
    if (!options.fields?.length) return;

    for (const field of options.fields) {
      this.buildIndex(options.data, field);
    }
  }

  /**
   * Builds an index for sorting the given field.
   */
  private buildIndex(data: T[], field: keyof T & string): this;
  private buildIndex(field: keyof T & string): this;
  private buildIndex(
    dataOrField: T[] | (keyof T & string),
    field?: keyof T & string,
  ): this {
    let data: T[];
    let resolvedField: keyof T & string;

    if (!Array.isArray(dataOrField)) {
      if (!this.data.length) {
        throw new Error(
          "SortEngine: no dataset in memory. " +
            "Either pass `data` in the constructor options, or call buildIndex(data, field).",
        );
      }

      data = this.data;
      resolvedField = dataOrField;
    } else {
      data = dataOrField;
      resolvedField = field!;
    }

    this.data = data;
    const itemCount = data.length;
    const indexes = new Uint32Array(itemCount);
    for (let i = 0; i < itemCount; i++) indexes[i] = i;

    const fieldValues = data.map((item) => item[resolvedField]);
    const firstValue = fieldValues[0];

    if (typeof firstValue === "number") {
      const numericValues = new Float64Array(itemCount);
      for (let i = 0; i < itemCount; i++)
        numericValues[i] = fieldValues[i] as number;
      indexes.sort((a, b) => numericValues[a] - numericValues[b]);
    } else {
      indexes.sort((a, b) => {
        const av = fieldValues[a] as string;
        const bv = fieldValues[b] as string;
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
    }

    this.cache.set(resolvedField as string, {
      indexes,
      dataRef: data,
      itemCount,
      fieldSnapshot: fieldValues,
    });
    return this;
  }

  /**
   * Clears all cached indexes.
   */
  clearIndexes(): this {
    this.cache.clear();
    return this;
  }

  clearData(): this {
    this.data = [];
    return this;
  }

  /**
   * Sorts the data based on the given descriptors.
   */
  sort(descriptors: SortDescriptor<T>[]): T[] & SortEngineChain<T>;
  sort(
    data: T[],
    descriptors: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] & SortEngineChain<T>;
  sort(
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace = false,
  ): T[] & SortEngineChain<T> {
    let data: T[];
    let resolvedDescriptors: SortDescriptor<T>[];

    if (descriptors === undefined) {
      if (!this.data.length) {
        throw new Error(
          "SortEngine: no dataset in memory. " +
            "Either pass `data` in the constructor options, or call sort(data, descriptors).",
        );
      }

      data = this.data;
      resolvedDescriptors = dataOrDescriptors as SortDescriptor<T>[];
    } else {
      data = dataOrDescriptors as T[];
      resolvedDescriptors = descriptors;
    }

    if (resolvedDescriptors.length === 0 || data.length === 0) {
      return this.withChain(data);
    }

    if (resolvedDescriptors.length === 1) {
      const { field, direction } = resolvedDescriptors[0];
      const cached = this.cache.get(field as string);

      if (
        cached &&
        cached.dataRef === data &&
        cached.itemCount === data.length &&
        this.isFieldSnapshotValid(data, field, cached.fieldSnapshot)
      ) {
        return this.withChain(
          this.reconstructFromIndex(data, cached.indexes, direction),
        );
      }
    }

    const sortableItems = inPlace ? data : data.slice();

    if (
      resolvedDescriptors.length === 1 &&
      data.length > 0 &&
      typeof data[0][resolvedDescriptors[0].field] === "number"
    ) {
      return this.withChain(
        this.radixSortNumeric(
          sortableItems,
          resolvedDescriptors[0].field,
          resolvedDescriptors[0].direction,
        ),
      );
    }

    const comparator = this.buildComparator(resolvedDescriptors);
    sortableItems.sort(comparator);
    return this.withChain(sortableItems);
  }

  private withChain(result: T[]): T[] & SortEngineChain<T> {
    const chainResult = result as T[] & SortEngineChain<T>;

    Object.defineProperty(chainResult, "sort", {
      value: (
        dataOrDescriptors: T[] | SortDescriptor<T>[],
        descriptors?: SortDescriptor<T>[],
        inPlace = false,
      ) => {
        if (descriptors === undefined) {
          return this.sort(
            result,
            dataOrDescriptors as SortDescriptor<T>[],
            inPlace,
          );
        }

        return this.sort(dataOrDescriptors as T[], descriptors, inPlace);
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "clearIndexes", {
      value: () => this.clearIndexes(),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "clearData", {
      value: () => this.clearData(),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    return chainResult;
  }

  /**
   * Reconstructs the sorted array from the cached index.
   */
  private reconstructFromIndex(
    data: T[],
    indexes: Uint32Array,
    direction: SortDirection,
  ): T[] {
    const itemCount = data.length;
    const result: T[] = new Array(itemCount);

    if (direction === "asc") {
      for (let i = 0; i < itemCount; i++) result[i] = data[indexes[i]];
    } else {
      for (let i = 0; i < itemCount; i++)
        result[i] = data[indexes[itemCount - 1 - i]];
    }

    return result;
  }

  /**
   * Checks if the field snapshot is still valid.
   */
  private isFieldSnapshotValid(
    data: T[],
    field: keyof T & string,
    snapshot: unknown[],
  ): boolean {
    for (let index = 0; index < data.length; index++) {
      if (data[index][field] !== snapshot[index]) return false;
    }

    return true;
  }

  /**
   * Builds a comparator function for sorting.
   */
  private buildComparator(
    descriptors: SortDescriptor<T>[],
  ): (a: T, b: T) => number {
    const fields = descriptors.map(({ field }) => field);
    const directionMultipliers = descriptors.map(({ direction }) =>
      direction === "asc" ? 1 : -1,
    );

    const fieldCount = fields.length;

    return (a: T, b: T): number => {
      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        const leftValue = a[fields[fieldIndex]];
        const rightValue = b[fields[fieldIndex]];

        if (leftValue < rightValue) return -directionMultipliers[fieldIndex];
        if (leftValue > rightValue) return directionMultipliers[fieldIndex];
      }
      return 0;
    };
  }

  /**
   * Sorts numeric data using radix sort.
   */
  private radixSortNumeric(
    data: T[],
    field: string,
    direction: SortDirection,
  ): T[] {
    const itemCount = data.length;

    const values = new Float64Array(itemCount);
    for (let index = 0; index < itemCount; index++) {
      values[index] = data[index][field] as number;
    }

    const indexes = new Uint32Array(itemCount);
    for (let index = 0; index < itemCount; index++) indexes[index] = index;

    indexes.sort((a, b) => values[a] - values[b]);

    const result: T[] = new Array(itemCount);
    if (direction === "asc") {
      for (let index = 0; index < itemCount; index++) {
        result[index] = data[indexes[index]];
      }
    } else {
      for (let index = 0; index < itemCount; index++) {
        result[itemCount - 1 - index] = data[indexes[index]];
      }
    }

    return result;
  }
}
