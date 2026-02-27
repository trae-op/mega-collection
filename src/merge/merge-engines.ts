/**
 * MergeEngines class that provides a unified interface for text search,
 * sorting, and filtering operations on collections.
 */

import type { CollectionItem, FilterCriterion, SortDescriptor } from "../types";

export interface EngineConstructor {
  new (options: Record<string, unknown>): object;
  prototype: object;
  name: string;
}

export interface EngineApi {
  [methodName: string]: ((...args: unknown[]) => unknown) | undefined;
}

export interface MergeEnginesOptions<T extends CollectionItem> {
  imports: EngineConstructor[];

  data: T[];

  [key: string]: unknown;
}

export class MergeEngines<T extends CollectionItem> {
  private readonly engine: EngineApi | null;

  constructor(options: MergeEnginesOptions<T>) {
    const { imports, data, ...moduleOptions } = options;

    const importedEngines = new Set<EngineConstructor>(imports);

    const engine: EngineApi = {};

    for (const EngineModule of importedEngines) {
      const prototype = EngineModule.prototype;
      const prototypeMethodNames = this.getMethodNames(prototype);

      if (prototypeMethodNames.length === 0) {
        continue;
      }

      const moduleOptionValue = moduleOptions[EngineModule.name];
      const currentModuleOptions: Record<string, unknown> = this.isRecord(
        moduleOptionValue,
      )
        ? moduleOptionValue
        : {};

      const moduleInstance = new EngineModule({
        data,
        ...currentModuleOptions,
      });

      for (const methodName of prototypeMethodNames) {
        if (engine[methodName]) {
          continue;
        }

        if (!this.hasMethod(moduleInstance, methodName)) {
          continue;
        }

        engine[methodName] = moduleInstance[methodName].bind(moduleInstance);
      }
    }

    this.engine = Object.keys(engine).length > 0 ? engine : null;
  }

  private getMethodNames(prototype: object): string[] {
    const prototypeRecord = prototype as Record<string, unknown>;

    return Object.getOwnPropertyNames(prototypeRecord).filter((methodName) => {
      if (methodName === "constructor") {
        return false;
      }

      return typeof prototypeRecord[methodName] === "function";
    });
  }

  private hasMethod(
    value: unknown,
    method: string,
  ): value is Record<string, (...args: unknown[]) => unknown> {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as Record<string, unknown>)[method] === "function"
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private callEngineMethod<TResult>(
    methodName: string,
    args: unknown[],
  ): TResult {
    const method = this.engine?.[methodName];

    if (!method) {
      throw new Error(
        `MergeEngines: Method "${methodName}" is not available. ` +
          `Add module with method "${methodName}" to the \`imports\` array.`,
      );
    }

    return method(...args) as TResult;
  }

  search(query: string): T[];
  search(field: keyof T & string, query: string): T[];
  search(fieldOrQuery: string, maybeQuery?: string): T[] {
    if (maybeQuery === undefined) {
      return this.callEngineMethod<T[]>("search", [fieldOrQuery]);
    }

    return this.callEngineMethod<T[]>("search", [
      fieldOrQuery as keyof T & string,
      maybeQuery,
    ]);
  }

  sort(descriptors: SortDescriptor<T>[]): T[];
  sort(data: T[], descriptors: SortDescriptor<T>[], inPlace?: boolean): T[];
  sort(
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] {
    if (descriptors === undefined) {
      return this.callEngineMethod<T[]>("sort", [
        dataOrDescriptors as SortDescriptor<T>[],
      ]);
    }

    return this.callEngineMethod<T[]>("sort", [
      dataOrDescriptors as T[],
      descriptors,
      inPlace,
    ]);
  }

  filter(criteria: FilterCriterion<T>[]): T[];
  filter(data: T[], criteria: FilterCriterion<T>[]): T[];
  filter(
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ): T[] {
    if (criteria === undefined) {
      return this.callEngineMethod<T[]>("filter", [
        dataOrCriteria as FilterCriterion<T>[],
      ]);
    }

    return this.callEngineMethod<T[]>("filter", [
      dataOrCriteria as T[],
      criteria,
    ]);
  }
}
