import type { CollectionItem, FilterCriterion } from "../types";
import type { FilterEngine } from "./filter";

export interface FilterEngineChain<T extends CollectionItem> {
  filter(criteria: FilterCriterion<T>[]): T[] & FilterEngineChain<T>;
  filter(data: T[], criteria: FilterCriterion<T>[]): T[] & FilterEngineChain<T>;
  getOriginData(): T[];
  data(data: T[]): FilterEngine<T>;
  clearIndexes(): FilterEngine<T>;
  clearData(): FilterEngine<T>;
  resetFilterState(): FilterEngine<T>;
}

type FilterEngineChainCallbacks<T extends CollectionItem> = {
  filter: (
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ) => T[] & FilterEngineChain<T>;
  getOriginData: () => T[];
  data: (data: T[]) => FilterEngine<T>;
  clearIndexes: () => FilterEngine<T>;
  clearData: () => FilterEngine<T>;
  resetFilterState: () => FilterEngine<T>;
};

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
