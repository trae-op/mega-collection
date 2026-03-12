import type {
  CollectionItem,
  FilterCriterion,
  UpdateDescriptor,
} from "../types";
import type { FilterEngineChain, FilterEngineChainCallbacks } from "./types";

export type { FilterEngineChain } from "./types";

function createChainMethodDescriptor<TValue>(
  value: TValue,
): PropertyDescriptor {
  return {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  };
}

export class FilterEngineChainBuilder<T extends CollectionItem> {
  constructor(private readonly callbacks: FilterEngineChainCallbacks<T>) {}

  create(result: T[]): T[] & FilterEngineChain<T> {
    const chainResult = result as T[] & FilterEngineChain<T>;

    Object.defineProperties(chainResult, {
      filter: createChainMethodDescriptor(
        (
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
      ),
      add: createChainMethodDescriptor((items: T[]) =>
        this.callbacks.add(items),
      ),
      update: createChainMethodDescriptor((descriptor: UpdateDescriptor<T>) =>
        this.callbacks.update(descriptor),
      ),
      clearIndexes: createChainMethodDescriptor(() =>
        this.callbacks.clearIndexes(),
      ),
      data: createChainMethodDescriptor((data: T[]) =>
        this.callbacks.data(data),
      ),
      getOriginData: createChainMethodDescriptor(() =>
        this.callbacks.getOriginData(),
      ),
      clearData: createChainMethodDescriptor(() => this.callbacks.clearData()),
      resetFilterState: createChainMethodDescriptor(() =>
        this.callbacks.resetFilterState(),
      ),
    });

    return chainResult;
  }
}
