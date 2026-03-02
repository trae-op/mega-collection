/**
 * MergeEngines class that provides a unified interface for text search,
 * sorting, and filtering operations on collections.
 */

import type { CollectionItem, FilterCriterion, SortDescriptor } from "../types";

type MergeModuleName = "search" | "sort" | "filter";

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

export interface MergeEnginesChain<T extends CollectionItem> {
  search(query: string): T[] & MergeEnginesChain<T>;
  search(field: keyof T & string, query: string): T[] & MergeEnginesChain<T>;
  sort(descriptors: SortDescriptor<T>[]): T[] & MergeEnginesChain<T>;
  sort(
    data: T[],
    descriptors: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] & MergeEnginesChain<T>;
  filter(criteria: FilterCriterion<T>[]): T[] & MergeEnginesChain<T>;
  filter(data: T[], criteria: FilterCriterion<T>[]): T[] & MergeEnginesChain<T>;
  getOriginData(module: MergeModuleName): T[];
  data(data: T[]): MergeEngines<T>;
  clearIndexes(module: MergeModuleName): T[] & MergeEnginesChain<T>;
  clearData(module: MergeModuleName): T[] & MergeEnginesChain<T>;
}

export class MergeEngines<T extends CollectionItem> {
  private readonly engine: EngineApi | null;

  private readonly clearIndexMethods: Partial<
    Record<MergeModuleName, () => unknown>
  >;

  private readonly clearDataMethods: Partial<
    Record<MergeModuleName, () => unknown>
  >;

  private readonly setDataMethods: Partial<
    Record<MergeModuleName, (data: T[]) => unknown>
  >;

  private readonly getOriginDataMethods: Partial<
    Record<MergeModuleName, () => T[]>
  >;

  /**
   * Creates a new MergeEngines instance with the given options.
   * Collects all modules from imports.
   */
  constructor(options: MergeEnginesOptions<T>) {
    const { imports, data, ...moduleOptions } = options;

    const importedEngines = new Set<EngineConstructor>(imports);

    const engine: EngineApi = {};
    const clearIndexMethods: Partial<Record<MergeModuleName, () => unknown>> =
      {};
    const clearDataMethods: Partial<Record<MergeModuleName, () => unknown>> =
      {};
    const setDataMethods: Partial<
      Record<MergeModuleName, (data: T[]) => unknown>
    > = {};
    const getOriginDataMethods: Partial<Record<MergeModuleName, () => T[]>> =
      {};

    for (const EngineModule of importedEngines) {
      const prototype = EngineModule.prototype;
      const prototypeMethodNames = this.getMethodNames(prototype);

      if (prototypeMethodNames.length === 0) {
        continue;
      }

      const currentModuleOptions = this.getModuleInitOptions(
        EngineModule.name,
        prototypeMethodNames,
        moduleOptions,
      );

      const moduleInstance = new EngineModule({
        data,
        ...currentModuleOptions,
      });

      const moduleName = this.getModuleName(prototypeMethodNames);
      if (
        moduleName &&
        this.hasMethod(moduleInstance, "clearIndexes") &&
        !clearIndexMethods[moduleName]
      ) {
        clearIndexMethods[moduleName] =
          moduleInstance.clearIndexes.bind(moduleInstance);
      }

      if (
        moduleName &&
        this.hasMethod(moduleInstance, "clearData") &&
        !clearDataMethods[moduleName]
      ) {
        clearDataMethods[moduleName] =
          moduleInstance.clearData.bind(moduleInstance);
      }

      if (
        moduleName &&
        this.hasMethod(moduleInstance, "data") &&
        !setDataMethods[moduleName]
      ) {
        setDataMethods[moduleName] = moduleInstance.data.bind(moduleInstance);
      }

      if (
        moduleName &&
        this.hasMethod(moduleInstance, "getOriginData") &&
        !getOriginDataMethods[moduleName]
      ) {
        getOriginDataMethods[moduleName] = moduleInstance.getOriginData.bind(
          moduleInstance,
        ) as () => T[];
      }

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
    this.clearIndexMethods = clearIndexMethods;
    this.clearDataMethods = clearDataMethods;
    this.setDataMethods = setDataMethods;
    this.getOriginDataMethods = getOriginDataMethods;
  }

  private getModuleName(methodNames: string[]): MergeModuleName | null {
    if (methodNames.includes("search")) {
      return "search";
    }

    if (methodNames.includes("sort")) {
      return "sort";
    }

    if (methodNames.includes("filter")) {
      return "filter";
    }

    return null;
  }

  /**
   * Gets the initialization options for a module.
   */
  private getModuleInitOptions(
    moduleName: string,
    methodNames: string[],
    options: Record<string, unknown>,
  ): Record<string, unknown> {
    const initOptions: Record<string, unknown> = {};

    const moduleNamedOptions = options[moduleName];
    if (this.isRecord(moduleNamedOptions)) {
      Object.assign(initOptions, moduleNamedOptions);
    }

    for (const methodName of methodNames) {
      const methodNamedOptions = options[methodName];

      if (!this.isRecord(methodNamedOptions)) {
        continue;
      }

      Object.assign(initOptions, methodNamedOptions);
    }

    return initOptions;
  }

  /**
   * Gets the method names from a prototype.
   */
  private getMethodNames(prototype: object): string[] {
    const prototypeRecord = prototype as Record<string, unknown>;

    return Object.getOwnPropertyNames(prototypeRecord).filter((methodName) => {
      if (methodName === "constructor") {
        return false;
      }

      return typeof prototypeRecord[methodName] === "function";
    });
  }

  /**
   * Checks if an object has a specific method.
   */
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

  /**
   * Calls a method on the engine.
   */
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

  search(query: string): T[] & MergeEnginesChain<T>;
  search(field: keyof T & string, query: string): T[] & MergeEnginesChain<T>;
  search(
    fieldOrQuery: string,
    maybeQuery?: string,
  ): T[] & MergeEnginesChain<T> {
    if (!this.engine?.search) {
      throw new Error(
        "MergeEngines: TextSearchEngine is not available. " +
          "Add TextSearchEngine to the `imports` array.",
      );
    }

    if (maybeQuery === undefined) {
      return this.withChain(
        this.callEngineMethod<T[]>("search", [fieldOrQuery]),
      );
    }

    return this.withChain(
      this.callEngineMethod<T[]>("search", [
        fieldOrQuery as keyof T & string,
        maybeQuery,
      ]),
    );
  }

  sort(descriptors: SortDescriptor<T>[]): T[] & MergeEnginesChain<T>;
  sort(
    data: T[],
    descriptors: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] & MergeEnginesChain<T>;
  sort(
    dataOrDescriptors: T[] | SortDescriptor<T>[],
    descriptors?: SortDescriptor<T>[],
    inPlace?: boolean,
  ): T[] & MergeEnginesChain<T> {
    if (!this.engine?.sort) {
      throw new Error(
        "MergeEngines: SortEngine is not available. " +
          "Add SortEngine to the `imports` array.",
      );
    }

    if (descriptors === undefined) {
      return this.withChain(
        this.callEngineMethod<T[]>("sort", [
          dataOrDescriptors as SortDescriptor<T>[],
        ]),
      );
    }

    return this.withChain(
      this.callEngineMethod<T[]>("sort", [
        dataOrDescriptors as T[],
        descriptors,
        inPlace,
      ]),
    );
  }

  filter(criteria: FilterCriterion<T>[]): T[] & MergeEnginesChain<T>;
  filter(data: T[], criteria: FilterCriterion<T>[]): T[] & MergeEnginesChain<T>;
  filter(
    dataOrCriteria: T[] | FilterCriterion<T>[],
    criteria?: FilterCriterion<T>[],
  ): T[] & MergeEnginesChain<T> {
    if (!this.engine?.filter) {
      throw new Error(
        "MergeEngines: FilterEngine is not available. " +
          "Add FilterEngine to the `imports` array.",
      );
    }

    if (criteria === undefined) {
      return this.withChain(
        this.callEngineMethod<T[]>("filter", [
          dataOrCriteria as FilterCriterion<T>[],
        ]),
      );
    }

    return this.withChain(
      this.callEngineMethod<T[]>("filter", [dataOrCriteria as T[], criteria]),
    );
  }

  private withChain(result: T[]): T[] & MergeEnginesChain<T> {
    const chainResult = result as T[] & MergeEnginesChain<T>;

    Object.defineProperty(chainResult, "search", {
      value: (fieldOrQuery: string, maybeQuery?: string) =>
        maybeQuery === undefined
          ? this.search(fieldOrQuery)
          : this.search(fieldOrQuery as keyof T & string, maybeQuery),
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

    Object.defineProperty(chainResult, "filter", {
      value: (
        dataOrCriteria: T[] | FilterCriterion<T>[],
        criteria?: FilterCriterion<T>[],
      ) => {
        if (criteria === undefined) {
          return this.filter(result, dataOrCriteria as FilterCriterion<T>[]);
        }

        return this.filter(dataOrCriteria as T[], criteria);
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "clearIndexes", {
      value: (module: MergeModuleName) => {
        this.clearIndexes(module);
        return this.withChain(result);
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "clearData", {
      value: (module: MergeModuleName) => {
        this.clearData(module);
        return this.withChain(result);
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "data", {
      value: (data: T[]) => this.data(data),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(chainResult, "getOriginData", {
      value: (module: MergeModuleName) => this.getOriginData(module),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    return chainResult;
  }

  getOriginData(module: MergeModuleName): T[] {
    const getOriginDataMethod = this.getOriginDataMethods[module];

    if (getOriginDataMethod) {
      return getOriginDataMethod();
    }

    const moduleToEngine = {
      search: "TextSearchEngine",
      sort: "SortEngine",
      filter: "FilterEngine",
    } as const;

    throw new Error(
      `MergeEngines: ${moduleToEngine[module]} is not available. ` +
        `Add ${moduleToEngine[module]} to the \`imports\` array.`,
    );
  }

  clearIndexes(module: MergeModuleName): this {
    const clearMethod = this.clearIndexMethods[module];

    if (clearMethod) {
      clearMethod();
      return this;
    }

    const moduleToEngine = {
      search: "TextSearchEngine",
      sort: "SortEngine",
      filter: "FilterEngine",
    } as const;

    throw new Error(
      `MergeEngines: ${moduleToEngine[module]} is not available. ` +
        `Add ${moduleToEngine[module]} to the \`imports\` array.`,
    );
  }

  data(data: T[]): this {
    const moduleNames: MergeModuleName[] = ["search", "sort", "filter"];

    for (const moduleName of moduleNames) {
      const setDataMethod = this.setDataMethods[moduleName];
      if (!setDataMethod) continue;
      setDataMethod(data);
    }

    return this;
  }

  clearData(module: MergeModuleName): this {
    const clearMethod = this.clearDataMethods[module];

    if (clearMethod) {
      clearMethod();
      return this;
    }

    const moduleToEngine = {
      search: "TextSearchEngine",
      sort: "SortEngine",
      filter: "FilterEngine",
    } as const;

    throw new Error(
      `MergeEngines: ${moduleToEngine[module]} is not available. ` +
        `Add ${moduleToEngine[module]} to the \`imports\` array.`,
    );
  }
}
