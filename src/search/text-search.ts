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

  minQueryLength?: number;
}

export interface TextSearchEngineChain<T extends CollectionItem> {
  search(query: string): T[] & TextSearchEngineChain<T>;
  search(
    field: keyof T & string,
    query: string,
  ): T[] & TextSearchEngineChain<T>;
  getOriginData(): T[];
  data(data: T[]): TextSearchEngine<T>;
  clearIndexes(): TextSearchEngine<T>;
  clearData(): TextSearchEngine<T>;
}

export class TextSearchEngine<T extends CollectionItem> {
  private ngramIndexes = new Map<string, Map<string, Set<number>>>();

  private dataset: T[] = [];

  private readonly indexedFields = new Set<keyof T & string>();

  private readonly minQueryLength: number;

  /**
   * Creates a new TextSearchEngine with optional data and fields to index.
   */
  constructor(options: TextSearchEngineOptions<T> = {}) {
    this.minQueryLength = options.minQueryLength ?? 1;

    if (!options.data) return;

    this.dataset = options.data;
    if (options.fields?.length) {
      for (const field of options.fields) {
        this.indexedFields.add(field);
      }

      this.rebuildConfiguredIndexes();
    }
  }

  private rebuildConfiguredIndexes(): void {
    this.ngramIndexes.clear();

    for (const field of this.indexedFields) {
      this.buildIndex(this.dataset, field);
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
    field: keyof T & string,
    query: string,
  ): T[] & TextSearchEngineChain<T>;
  search(
    fieldOrQuery: string,
    maybeQuery?: string,
  ): T[] & TextSearchEngineChain<T> {
    if (maybeQuery === undefined) {
      return this.withChain(this.searchAllFields(fieldOrQuery));
    }

    return this.withChain(
      this.searchField(fieldOrQuery as keyof T & string, maybeQuery),
    );
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
  private searchField(field: keyof T & string, query: string): T[] {
    const lowerQuery = this.normalizeQuery(query);

    // empty queries should return original data
    if (!lowerQuery) {
      return this.dataset;
    }

    if (lowerQuery.length < this.minQueryLength) {
      // nonempty but shorter than threshold: return all data rather than
      // an empty list
      return this.dataset;
    }

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
    field: keyof T & string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
  ): T[] {
    const ngramMap = this.ngramIndexes.get(field as string);
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

      const fieldValue = candidateItem[field];
      if (
        typeof fieldValue === "string" &&
        fieldValue.toLowerCase().includes(lowerQuery)
      ) {
        matchedItems.push(candidateItem);
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

      if (hasMatch) {
        matchedItems.push(item);
      }
    }

    return matchedItems;
  }

  /**
   * Searches a specific field linearly without index.
   */
  private searchFieldLinear(field: keyof T & string, lowerQuery: string): T[] {
    if (!this.dataset.length) return [];

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
    return this;
  }
}
