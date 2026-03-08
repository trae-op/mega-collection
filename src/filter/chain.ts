import type { CollectionItem, FilterCriterion } from "../types";
import type { FilterEngineChain, FilterEngineChainCallbacks } from "./types";

export type { FilterEngineChain } from "./types";

export class FilterEngineChainBuilder<T extends CollectionItem> {
  constructor(private readonly callbacks: FilterEngineChainCallbacks<T>) {}

  create(result: T[]): T[] & FilterEngineChain<T> {
    const chainResult = result as T[] & FilterEngineChain<T>;

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
      value: () => this.callbacks.clearIndexes(),
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

    Object.defineProperty(chainResult, "clearData", {
      value: () => this.callbacks.clearData(),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "resetFilterState", {
      value: () => this.callbacks.resetFilterState(),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    return chainResult;
  }
}
