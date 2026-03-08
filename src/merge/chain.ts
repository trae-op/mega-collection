import type { CollectionItem, FilterCriterion, SortDescriptor } from "../types";
import type {
  MergeEnginesChain,
  MergeEnginesChainCallbacks,
  MergeModuleName,
} from "./types";

export type { MergeEnginesChain, MergeModuleName } from "./types";

export class MergeEnginesChainBuilder<T extends CollectionItem> {
  constructor(private readonly callbacks: MergeEnginesChainCallbacks<T>) {}

  create(result: T[]): T[] & MergeEnginesChain<T> {
    const chainResult = result as T[] & MergeEnginesChain<T>;

    Object.defineProperty(chainResult, "search", {
      value: (fieldOrQuery: string, maybeQuery?: string) =>
        maybeQuery === undefined
          ? this.callbacks.search(fieldOrQuery)
          : this.callbacks.search(fieldOrQuery, maybeQuery),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "sort", {
      value: (
        dataOrDescriptors: T[] | SortDescriptor<T>[],
        descriptors?: SortDescriptor<T>[],
        inPlace?: boolean,
      ) => {
        if (descriptors === undefined) {
          return this.callbacks.sort(
            result,
            dataOrDescriptors as SortDescriptor<T>[],
            inPlace,
          );
        }

        return this.callbacks.sort(
          dataOrDescriptors as T[],
          descriptors,
          inPlace,
        );
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "filter", {
      value: (
        dataOrCriteria: T[] | FilterCriterion<T>[],
        criteria?: FilterCriterion<T>[],
      ) => {
        if (criteria === undefined) {
          return this.callbacks.filter(
            result,
            dataOrCriteria as FilterCriterion<T>[],
          );
        }

        return this.callbacks.filter(dataOrCriteria as T[], criteria);
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "clearIndexes", {
      value: (module: MergeModuleName) => {
        this.callbacks.clearIndexes(module);
        return this.create(result);
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "clearData", {
      value: (module: MergeModuleName) => {
        this.callbacks.clearData(module);
        return this.create(result);
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "data", {
      value: (data: T[]) => this.callbacks.data(data),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "getOriginData", {
      value: () => this.callbacks.getOriginData(),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    return chainResult;
  }
}
