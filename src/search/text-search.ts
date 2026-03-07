/**
 * TextSearchEngine class for performing fast substring search on string fields
 * using n-gram indexing and intersection.
 */

import { CollectionItem } from "../types";

const MAXIMUM_NGRAM_LENGTH = 3;
const MAXIMUM_QUERY_GRAMS_FOR_INTERSECTION = 12;

function extractQueryGrams(input: string): string[] {
  const lower = input.toLowerCase();
  const gramLength = Math.min(MAXIMUM_NGRAM_LENGTH, lower.length);
  const gramCount = lower.length - gramLength + 1;
  const queryGrams = new Array<string>(gramCount);
  for (let index = 0; index < gramCount; index++) {
    queryGrams[index] = lower.substring(index, index + gramLength);
  }
  return queryGrams;
}

function buildIntersectionQueryGrams(lowerQuery: string): ReadonlySet<string> {
  const allGrams = extractQueryGrams(lowerQuery);
  if (allGrams.length <= MAXIMUM_QUERY_GRAMS_FOR_INTERSECTION) {
    return new Set(allGrams);
  }

  const selected = new Set<string>();
  const maxIndex = allGrams.length - 1;
  const steps = MAXIMUM_QUERY_GRAMS_FOR_INTERSECTION - 1;

  for (let step = 0; step <= steps; step++) {
    const index = Math.round((step * maxIndex) / steps);
    selected.add(allGrams[index]);
  }

  return selected;
}

function getOrCreatePostingList(
  ngramMap: Map<string, Set<number>>,
  ngram: string,
): Set<number> {
  const existingPostingList = ngramMap.get(ngram);
  if (existingPostingList) return existingPostingList;

  const newPostingList = new Set<number>();
  ngramMap.set(ngram, newPostingList);
  return newPostingList;
}

export interface TextSearchEngineOptions<
  T extends CollectionItem = CollectionItem,
> {
  data?: T[];

  fields?: (keyof T & string)[];

  nestedFields?: string[];

  minQueryLength?: number;
}

export interface TextSearchEngineChain<T extends CollectionItem> {
  search(query: string): T[] & TextSearchEngineChain<T>;
  search(
    field: (keyof T & string) | (string & {}),
    query: string,
  ): T[] & TextSearchEngineChain<T>;
  getOriginData(): T[];
  data(data: T[]): TextSearchEngine<T>;
  clearIndexes(): TextSearchEngine<T>;
  clearData(): TextSearchEngine<T>;
}

export class TextSearchEngine<T extends CollectionItem> {
  private ngramIndexes = new Map<string, Map<string, Set<number>>>();

  private nestedFieldValues = new Map<string, Map<number, string[]>>();

  private dataset: T[] = [];

  private readonly indexedFields = new Set<keyof T & string>();

  private readonly nestedIndexedFields = new Set<string>();

  private readonly minQueryLength: number;

  /**
   * Creates a new TextSearchEngine with optional data and fields to index.
   */
  constructor(options: TextSearchEngineOptions<T> = {}) {
    this.minQueryLength = options.minQueryLength ?? 1;

    if (options.nestedFields?.length) {
      for (const nestedField of options.nestedFields) {
        this.nestedIndexedFields.add(nestedField);
      }
    }

    if (!options.data) return;

    this.dataset = options.data;

    const hasFields = options.fields?.length;
    const hasNestedFields = this.nestedIndexedFields.size > 0;

    if (hasFields) {
      for (const field of options.fields!) {
        this.indexedFields.add(field);
      }
    }

    if (hasFields || hasNestedFields) {
      this.rebuildConfiguredIndexes();
    }
  }

  private rebuildConfiguredIndexes(): void {
    this.ngramIndexes.clear();
    this.nestedFieldValues.clear();

    for (const field of this.indexedFields) {
      this.buildIndex(this.dataset, field);
    }

    for (const nestedField of this.nestedIndexedFields) {
      this.buildNestedIndex(this.dataset, nestedField);
    }
  }

  /**
   * Builds an n-gram index for the given field.
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
      if (!this.dataset.length) {
        throw new Error(
          "TextSearchEngine: no dataset in memory. " +
            "Either pass `data` in the constructor options, or call buildIndex(data, field).",
        );
      }

      data = this.dataset;
      resolvedField = dataOrField;
    } else {
      data = dataOrField;
      resolvedField = field!;
    }

    this.dataset = data;

    const ngramMap = new Map<string, Set<number>>();

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const rawValue = data[itemIndex][resolvedField];
      if (typeof rawValue !== "string") continue;

      const lower = rawValue.toLowerCase();

      for (
        let startIndex = 0, lowerLength = lower.length;
        startIndex < lowerLength;
        startIndex++
      ) {
        const remainingLength = lowerLength - startIndex;
        const maxLengthAtPosition = Math.min(
          MAXIMUM_NGRAM_LENGTH,
          remainingLength,
        );
        for (
          let gramLength = 1;
          gramLength <= maxLengthAtPosition;
          gramLength++
        ) {
          const ngram = lower.substring(startIndex, startIndex + gramLength);
          getOrCreatePostingList(ngramMap, ngram).add(itemIndex);
        }
      }
    }

    this.ngramIndexes.set(resolvedField as string, ngramMap);
    return this;
  }

  search(query: string): T[] & TextSearchEngineChain<T>;
  search(
    field: (keyof T & string) | (string & {}),
    query: string,
  ): T[] & TextSearchEngineChain<T>;
  search(
    fieldOrQuery: string,
    maybeQuery?: string,
  ): T[] & TextSearchEngineChain<T> {
    if (maybeQuery === undefined) {
      return this.withChain(this.searchAllFields(fieldOrQuery));
    }

    return this.withChain(this.searchField(fieldOrQuery, maybeQuery));
  }

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  /**
   * Searches all indexed fields.
   */
  private searchAllFields(query: string): T[] {
    const fields = [...this.ngramIndexes.keys()] as (keyof T & string)[];
    const lowerQuery = this.normalizeQuery(query);

    if (!lowerQuery) {
      return this.dataset;
    }

    if (lowerQuery.length < this.minQueryLength) {
      return this.dataset;
    }

    if (!fields.length) {
      return this.searchAllFieldsLinear(lowerQuery);
    }

    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    if (!uniqueQueryGrams.size) return [];

    const seenItems = new Set<T>();
    const combined: T[] = [];

    for (const field of fields) {
      for (const item of this.searchFieldWithPreparedQuery(
        field,
        lowerQuery,
        uniqueQueryGrams,
      )) {
        if (!seenItems.has(item)) {
          seenItems.add(item);
          combined.push(item);
        }
      }
    }

    return combined;
  }

  /**
   * Searches a specific field.
   */
  private searchField(field: string, query: string): T[] {
    const lowerQuery = this.normalizeQuery(query);

    if (!lowerQuery) return this.dataset;

    if (lowerQuery.length < this.minQueryLength) return this.dataset;

    if (!this.ngramIndexes.size) {
      return this.searchFieldLinear(field, lowerQuery);
    }

    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    if (!uniqueQueryGrams.size) return [];

    return this.searchFieldWithPreparedQuery(
      field,
      lowerQuery,
      uniqueQueryGrams,
    );
  }

  /**
   * Searches a field using prepared query grams.
   */
  private searchFieldWithPreparedQuery(
    field: string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
  ): T[] {
    const ngramMap = this.ngramIndexes.get(field);
    if (!ngramMap) return [];

    const postingLists: Set<number>[] = [];

    for (const queryGram of uniqueQueryGrams) {
      const postingList = ngramMap.get(queryGram);
      if (!postingList) return [];
      postingLists.push(postingList);
    }

    postingLists.sort(
      (leftPostingList, rightPostingList) =>
        leftPostingList.size - rightPostingList.size,
    );

    const smallestPostingList = postingLists[0];
    const totalPostingLists = postingLists.length;
    const matchedItems: T[] = [];
    const isNested = this.nestedIndexedFields.has(field);
    const nestedValues = isNested
      ? this.nestedFieldValues.get(field)
      : undefined;

    for (const candidateIndex of smallestPostingList) {
      let isCandidate = true;
      for (let listIndex = 1; listIndex < totalPostingLists; listIndex++) {
        if (!postingLists[listIndex].has(candidateIndex)) {
          isCandidate = false;
          break;
        }
      }
      if (!isCandidate) continue;

      const candidateItem = this.dataset[candidateIndex];
      if (!candidateItem) continue;

      if (isNested) {
        const values = nestedValues?.get(candidateIndex);
        if (!values) continue;

        let hasMatch = false;
        for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
          if (values[valueIndex].includes(lowerQuery)) {
            hasMatch = true;
            break;
          }
        }

        if (hasMatch) {
          matchedItems.push(candidateItem);
        }
      } else {
        const fieldValue = candidateItem[field];
        if (
          typeof fieldValue === "string" &&
          fieldValue.toLowerCase().includes(lowerQuery)
        ) {
          matchedItems.push(candidateItem);
        }
      }
    }

    return matchedItems;
  }

  /**
   * Searches all fields linearly without index.
   */
  private searchAllFieldsLinear(lowerQuery: string): T[] {
    if (!this.dataset.length) return [];

    const matchedItems: T[] = [];

    for (let itemIndex = 0; itemIndex < this.dataset.length; itemIndex++) {
      const item = this.dataset[itemIndex];
      let hasMatch = false;

      for (const value of Object.values(item)) {
        if (typeof value !== "string") continue;
        if (!value.toLowerCase().includes(lowerQuery)) continue;

        hasMatch = true;
        break;
      }

      if (!hasMatch) {
        hasMatch = this.matchNestedFieldsLinear(item, lowerQuery);
      }

      if (hasMatch) {
        matchedItems.push(item);
      }
    }

    return matchedItems;
  }

  /**
   * Searches a specific field linearly without index.
   */
  private searchFieldLinear(field: string, lowerQuery: string): T[] {
    if (!this.dataset.length) return [];

    if (this.nestedIndexedFields.has(field)) {
      return this.searchNestedFieldLinear(field, lowerQuery);
    }

    const matchedItems: T[] = [];

    for (let itemIndex = 0; itemIndex < this.dataset.length; itemIndex++) {
      const fieldValue = this.dataset[itemIndex][field];
      if (typeof fieldValue !== "string") continue;
      if (!fieldValue.toLowerCase().includes(lowerQuery)) continue;
      matchedItems.push(this.dataset[itemIndex]);
    }

    return matchedItems;
  }

  private withChain(result: T[]): T[] & TextSearchEngineChain<T> {
    const chainResult = result as T[] & TextSearchEngineChain<T>;

    Object.defineProperty(chainResult, "search", {
      value: (fieldOrQuery: string, maybeQuery?: string) =>
        maybeQuery === undefined
          ? this.search(fieldOrQuery)
          : this.search(fieldOrQuery as keyof T & string, maybeQuery),
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

    Object.defineProperty(chainResult, "getOriginData", {
      value: () => this.getOriginData(),
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

    Object.defineProperty(chainResult, "clearData", {
      value: () => this.clearData(),
      enumerable: false,
      configurable: true,
      writable: true,
    });

    return chainResult;
  }

  clearIndexes(): this {
    this.ngramIndexes.clear();
    this.nestedFieldValues.clear();
    return this;
  }

  getOriginData(): T[] {
    return this.dataset;
  }

  data(data: T[]): this {
    this.dataset = data;
    this.rebuildConfiguredIndexes();
    return this;
  }

  clearData(): this {
    this.dataset = [];
    this.ngramIndexes.clear();
    this.nestedFieldValues.clear();
    return this;
  }

  /**
   * Builds an n-gram index for a nested collection field (e.g. "orders.status").
   */
  private buildNestedIndex(data: T[], nestedFieldPath: string): void {
    const dotIndex = nestedFieldPath.indexOf(".");
    if (dotIndex === -1) return;

    const collectionKey = nestedFieldPath.substring(0, dotIndex);
    const nestedKey = nestedFieldPath.substring(dotIndex + 1);

    const ngramMap = new Map<string, Set<number>>();
    const fieldValues = new Map<number, string[]>();

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const collection = data[itemIndex][collectionKey];
      if (!Array.isArray(collection)) continue;

      const values: string[] = [];

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const rawValue = collection[nestedIndex][nestedKey];
        if (typeof rawValue !== "string") continue;

        const lower = rawValue.toLowerCase();
        values.push(lower);

        for (
          let startIndex = 0, lowerLength = lower.length;
          startIndex < lowerLength;
          startIndex++
        ) {
          const remainingLength = lowerLength - startIndex;
          const maxLengthAtPosition = Math.min(
            MAXIMUM_NGRAM_LENGTH,
            remainingLength,
          );
          for (
            let gramLength = 1;
            gramLength <= maxLengthAtPosition;
            gramLength++
          ) {
            const ngram = lower.substring(startIndex, startIndex + gramLength);
            getOrCreatePostingList(ngramMap, ngram).add(itemIndex);
          }
        }
      }

      if (values.length > 0) {
        fieldValues.set(itemIndex, values);
      }
    }

    this.ngramIndexes.set(nestedFieldPath, ngramMap);
    this.nestedFieldValues.set(nestedFieldPath, fieldValues);
  }

  /**
   * Linearly searches a nested field path across all dataset items.
   */
  private searchNestedFieldLinear(fieldPath: string, lowerQuery: string): T[] {
    const dotIndex = fieldPath.indexOf(".");
    if (dotIndex === -1) return [];

    const collectionKey = fieldPath.substring(0, dotIndex);
    const nestedKey = fieldPath.substring(dotIndex + 1);
    const matchedItems: T[] = [];

    for (let itemIndex = 0; itemIndex < this.dataset.length; itemIndex++) {
      const collection = this.dataset[itemIndex][collectionKey];
      if (!Array.isArray(collection)) continue;

      let hasMatch = false;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const rawValue = collection[nestedIndex][nestedKey];
        if (typeof rawValue !== "string") continue;

        if (rawValue.toLowerCase().includes(lowerQuery)) {
          hasMatch = true;
          break;
        }
      }

      if (hasMatch) {
        matchedItems.push(this.dataset[itemIndex]);
      }
    }

    return matchedItems;
  }

  /**
   * Checks if any configured nested field matches the query for a single item.
   */
  private matchNestedFieldsLinear(item: T, lowerQuery: string): boolean {
    for (const fieldPath of this.nestedIndexedFields) {
      const dotIndex = fieldPath.indexOf(".");
      if (dotIndex === -1) continue;

      const collectionKey = fieldPath.substring(0, dotIndex);
      const nestedKey = fieldPath.substring(dotIndex + 1);
      const collection = item[collectionKey];

      if (!Array.isArray(collection)) continue;

      for (
        let nestedIndex = 0;
        nestedIndex < collection.length;
        nestedIndex++
      ) {
        const rawValue = collection[nestedIndex][nestedKey];
        if (typeof rawValue !== "string") continue;

        if (rawValue.toLowerCase().includes(lowerQuery)) {
          return true;
        }
      }
    }

    return false;
  }
}
