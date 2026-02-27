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

export class TextSearchEngine<T extends CollectionItem> {
  private ngramIndexes = new Map<string, Map<string, Set<number>>>();

  private data: T[] = [];

  private readonly minQueryLength: number;

  /**
   * Creates a new TextSearchEngine with optional data and fields to index.
   */
  constructor(options: TextSearchEngineOptions<T> = {}) {
    this.minQueryLength = options.minQueryLength ?? 1;

    if (!options.data) return;

    this.data = options.data;
    if (!options.fields?.length) return;

    for (const field of options.fields) {
      this.buildIndex(options.data, field);
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
      if (!this.data.length) {
        throw new Error(
          "TextSearchEngine: no dataset in memory. " +
            "Either pass `data` in the constructor options, or call buildIndex(data, field).",
        );
      }

      data = this.data;
      resolvedField = dataOrField;
    } else {
      data = dataOrField;
      resolvedField = field!;
    }

    this.data = data;

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

  search(query: string): T[];
  search(field: keyof T & string, query: string): T[];
  search(fieldOrQuery: string, maybeQuery?: string): T[] {
    if (maybeQuery === undefined) {
      return this.searchAllFields(fieldOrQuery);
    }

    return this.searchField(fieldOrQuery as keyof T & string, maybeQuery);
  }

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  /**
   * Checks if the query is long enough to search.
   */
  private isQuerySearchable(lowerQuery: string): boolean {
    if (!lowerQuery) return false;
    if (lowerQuery.length < this.minQueryLength) return false;
    return true;
  }

  /**
   * Searches all indexed fields.
   */
  private searchAllFields(query: string): T[] {
    const fields = [...this.ngramIndexes.keys()] as (keyof T & string)[];
    const lowerQuery = this.normalizeQuery(query);
    if (!this.isQuerySearchable(lowerQuery)) return [];

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
    if (!this.isQuerySearchable(lowerQuery)) return [];

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

      const fieldValue = this.data[candidateIndex][field];
      if (
        typeof fieldValue === "string" &&
        fieldValue.toLowerCase().includes(lowerQuery)
      ) {
        matchedItems.push(this.data[candidateIndex]);
      }
    }

    return matchedItems;
  }

  /**
   * Searches all fields linearly without index.
   */
  private searchAllFieldsLinear(lowerQuery: string): T[] {
    if (!this.data.length) return [];

    const matchedItems: T[] = [];

    for (let itemIndex = 0; itemIndex < this.data.length; itemIndex++) {
      const item = this.data[itemIndex];
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
    if (!this.data.length) return [];

    const matchedItems: T[] = [];

    for (let itemIndex = 0; itemIndex < this.data.length; itemIndex++) {
      const fieldValue = this.data[itemIndex][field];
      if (typeof fieldValue !== "string") continue;
      if (!fieldValue.toLowerCase().includes(lowerQuery)) continue;
      matchedItems.push(this.data[itemIndex]);
    }

    return matchedItems;
  }

  clear(): void {
    this.ngramIndexes.clear();
    this.data = [];
  }
}
