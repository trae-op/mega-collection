import type {
  CollectionItem,
  FilterCriterion,
  IndexableKey,
  SortDescriptor,
  UpdateDescriptor,
} from "../types";
import { createChainMethodDescriptor } from "../internal";
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

    Object.defineProperties(chainResult, {
      search: createChainMethodDescriptor(
        (fieldOrQuery: string, maybeQuery?: string) =>
          maybeQuery === undefined
            ? this.callbacks.search(fieldOrQuery)
            : this.callbacks.search(fieldOrQuery, maybeQuery),
      ),
      sort: createChainMethodDescriptor(
        (
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
      ),
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
      delete: createChainMethodDescriptor(
        (
          field: IndexableKey<T> & string,
          valueOrValues:
            | T[IndexableKey<T> & string]
            | T[IndexableKey<T> & string][],
        ) => this.callbacks.delete(field, valueOrValues),
      ),
      update: createChainMethodDescriptor((descriptor: UpdateDescriptor<T>) =>
        this.callbacks.update(descriptor),
      ),
      clearIndexes: createChainMethodDescriptor((module: MergeModuleName) => {
        this.callbacks.clearIndexes(module);
        return this.create(result);
      }),
      clearData: createChainMethodDescriptor((module: MergeModuleName) => {
        this.callbacks.clearData(module);
        return this.create(result);
      }),
      data: createChainMethodDescriptor((data: T[]) =>
        this.callbacks.data(data),
      ),
      getOriginData: createChainMethodDescriptor(() =>
        this.callbacks.getOriginData(),
      ),
    });

    return chainResult;
  }
}
