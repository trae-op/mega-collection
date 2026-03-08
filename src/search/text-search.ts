/**
 * TextSearchEngine class for performing fast substring search on string fields
 * using n-gram indexing and intersection.
 */

import { CollectionItem } from "../types";
import { TextSearchEngineChain, TextSearchEngineChainBuilder } from "./chain";
import type { TextSearchEngineOptions } from "./types";
import { TextSearchEngineError } from "./errors";
import { buildIntersectionQueryGrams, indexLowerValue } from "./ngram";
import { SearchNestedCollection } from "./nested";

export class TextSearchEngine<T extends CollectionItem> {
  private ngramIndexes = new Map<string, Map<string, Set<number>>>();

  private normalizedFieldValues = new Map<string, string[]>();

  private dataset: T[] = [];

  private readonly indexedFields = new Set<keyof T & string>();

  private readonly nestedCollection = new SearchNestedCollection<T>();

  private readonly minQueryLength: number;

  private readonly chainBuilder = new TextSearchEngineChainBuilder<T>({
    search: (fieldOrQuery, maybeQuery) => {
      if (maybeQuery === undefined) {
        return this.search(fieldOrQuery);
      }

      return this.search(fieldOrQuery as keyof T & string, maybeQuery);
    },
    getOriginData: () => this.getOriginData(),
    data: (data) => this.data(data),
    clearIndexes: () => this.clearIndexes(),
    clearData: () => this.clearData(),
  });

  /**
   * Creates a new TextSearchEngine with optional data and fields to index.
   */
  constructor(options: TextSearchEngineOptions<T> = {}) {
    this.minQueryLength = options.minQueryLength ?? 1;
    this.nestedCollection.registerFields(options.nestedFields);

    if (!options.data) return;

    this.dataset = options.data;

    const hasFields = options.fields?.length;
    const hasNestedFields = this.nestedCollection.hasRegisteredFields();

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
    this.normalizedFieldValues.clear();
    this.nestedCollection.clearIndexes();

    for (const field of this.indexedFields) {
      this.buildIndex(this.dataset, field);
    }

    if (this.nestedCollection.hasRegisteredFields()) {
      this.nestedCollection.buildIndexes(this.dataset);
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
        throw TextSearchEngineError.missingDatasetForBuildIndex();
      }

      data = this.dataset;
      resolvedField = dataOrField;
    } else {
      data = dataOrField;
      resolvedField = field!;
    }

    this.dataset = data;

    const ngramMap = new Map<string, Set<number>>();
    const normalizedValues = new Array<string>(data.length);

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const rawValue = data[itemIndex][resolvedField];
      if (typeof rawValue !== "string") continue;

      const lower = rawValue.toLowerCase();
      normalizedValues[itemIndex] = lower;
      indexLowerValue(ngramMap, lower, itemIndex);
    }

    this.ngramIndexes.set(resolvedField as string, ngramMap);
    this.normalizedFieldValues.set(resolvedField as string, normalizedValues);
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

    if (!fields.length && !this.nestedCollection.hasIndexes()) {
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

    for (const item of this.nestedCollection.searchAllIndexedFields(
      this.dataset,
      lowerQuery,
      uniqueQueryGrams,
    )) {
      if (seenItems.has(item)) continue;

      seenItems.add(item);
      combined.push(item);
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

    if (this.nestedCollection.hasField(field)) {
      const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
      if (!uniqueQueryGrams.size) return [];

      if (this.nestedCollection.hasIndexes()) {
        return this.nestedCollection.searchIndexedField(
          this.dataset,
          field,
          lowerQuery,
          uniqueQueryGrams,
        );
      }

      return this.nestedCollection.searchFieldLinear(
        this.dataset,
        field,
        lowerQuery,
      );
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
    const normalizedValues = this.normalizedFieldValues.get(field);

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

      const normalizedValue = normalizedValues?.[candidateIndex];
      if (normalizedValue?.includes(lowerQuery)) {
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

      if (!hasMatch) {
        hasMatch = this.nestedCollection.matchesAnyField(item, lowerQuery);
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

    if (this.nestedCollection.hasField(field)) {
      return this.nestedCollection.searchFieldLinear(
        this.dataset,
        field,
        lowerQuery,
      );
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
    return this.chainBuilder.create(result);
  }

  clearIndexes(): this {
    this.ngramIndexes.clear();
    this.normalizedFieldValues.clear();
    this.nestedCollection.clearIndexes();
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
    this.normalizedFieldValues.clear();
    this.nestedCollection.clearIndexes();
    return this;
  }
}
