import type { CollectionItem, SortDescriptor } from "../types";
import type { SortEngineChain, SortEngineChainCallbacks } from "./types";

export type { SortEngineChain } from "./types";

export class SortEngineChainBuilder<T extends CollectionItem> {
  constructor(private readonly callbacks: SortEngineChainCallbacks<T>) {}

  create(result: T[]): T[] & SortEngineChain<T> {
    const chainResult = result as T[] & SortEngineChain<T>;

    Object.defineProperty(chainResult, "sort", {
      value: (
        dataOrDescriptors: T[] | SortDescriptor<T>[],
        descriptors?: SortDescriptor<T>[],
        inPlace = false,
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

    return chainResult;
  }
}
