/**
 * TextSearchEngine — fast substring search on 10 M+ string fields.
 *
 * Strategy:
 *  1. **N-gram index (1..3 chars)** — every string is split into overlapping
 *     1/2/3-character grams. Each gram maps to a Set of item indexes.
 *     At query time we intersect posting lists to get *candidates*, then verify
 *     with `String.includes` (which is very fast on a small candidate set).
 *
 *  Building the trigram index is O(n·L) where L is average string length.
 *  Query time is roughly O(|candidates| + |postingList intersections|).
 */

import { CollectionItem } from "../types";

const MAXIMUM_NGRAM_LENGTH = 3;
const MAXIMUM_QUERY_GRAMS_FOR_INTERSECTION = 12;

/** Extract query grams using the longest available gram length (1..3). */
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
  /**
   * The dataset to index. When provided together with `fields`, all indexes
   * are built automatically inside the constructor — no manual `buildIndex`
   * calls needed.
   *
   * @example
   * ```ts
   * const engine = new TextSearchEngine<User>({ data: users, fields: ["name", "city"] });
   * engine.search("john"); // searches both fields, deduplicated
   * ```
   */
  data?: T[];

  /**
   * Fields to build a trigram index for. Requires `data` to be set as well.
   * When both are present, `buildIndex` is called for each field in the constructor.
   */
  fields?: (keyof T & string)[];

  /**
   * Minimum number of characters required before a search is executed.
   * Queries shorter than this return an empty array immediately.
   *
   * Why this matters: a single-character query uses 1-grams whose posting
   * lists can span the majority of the dataset (e.g. "a" matches 70–80 % of
   * names/cities), forcing `String.includes` verification over tens of
   * thousands of candidates.  Setting this to 2 or 3 dramatically reduces
   * the candidate set and keeps searches fast even with 100 k+ items.
   *
   * @default 1  (backwards-compatible; set to 2 or 3 for better perf)
   */
  minQueryLength?: number;
}

export class TextSearchEngine<T extends CollectionItem> {
  /**
   * field → ngram → Set<index in data[]>
   * We store *indexes into the data array* (not the objects) to save memory.
   */
  private ngramIndexes = new Map<string, Map<string, Set<number>>>();

  /** Reference to the full dataset (set once via `buildIndex` or the constructor). */
  private data: T[] = [];

  /** Minimum query length before the engine executes a search. */
  private readonly minQueryLength: number;

  constructor(options: TextSearchEngineOptions<T> = {}) {
    this.minQueryLength = options.minQueryLength ?? 1;

    if (!options.data) return;

    // Always store the dataset so buildIndex(field) can reuse it later,
    // even when `fields` is not specified in the constructor.
    this.data = options.data;
    if (!options.fields?.length) return;

    for (const field of options.fields) {
      this.buildIndex(options.data, field);
    }
  }

  /**
   * Build n-gram index (1..3 chars) for one field. O(n·L).
   *
   * Two call signatures are supported:
   *  - `buildIndex(data, field)` — explicit dataset (original API)
   *  - `buildIndex(field)`       — reuses the dataset supplied in the constructor
   *
   * Trigram extraction is inlined to avoid allocating a temporary array
   * and a deduplication Set per item.  Posting lists are `Set<number>`,
   * so duplicate `.add()` calls for the same itemIndex are no-ops — we
   * get correctness without per-item deduplication overhead.
   *
   * For 10 M+ items this eliminates ~20 M transient object allocations
   * and dramatically reduces GC pressure.
   */
  buildIndex(data: T[], field: keyof T & string): this;
  buildIndex(field: keyof T & string): this;
  buildIndex(
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

      // Inline n-gram extraction (1..3 chars) — no intermediate array or Set created.
      // Set.add is idempotent, so duplicate grams within one string
      // are harmless and far cheaper than per-item Set allocation.
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

  /**
   * Search items by substring (contains) using the trigram index.
   *
   * Two call signatures are supported:
   *  - `search(query)`        — searches **all** indexed fields and returns a
   *                             deduplicated union (preserves field order).
   *  - `search(field, query)` — searches a single specific field.
   *
   * Both paths return only items whose field value actually contains the query
   * (trigram candidates are verified with `String.includes`).
   */
  search(query: string): T[];
  search(field: keyof T & string, query: string): T[];
  search(fieldOrQuery: string, maybeQuery?: string): T[] {
    if (maybeQuery === undefined) {
      // search(query) — across all indexed fields
      return this.searchAllFields(fieldOrQuery);
    }
    // search(field, query) — specific field only
    return this.searchField(fieldOrQuery as keyof T & string, maybeQuery);
  }

  /** Search across every indexed field and return a deduplicated union. */
  private searchAllFields(query: string): T[] {
    const fields = [...this.ngramIndexes.keys()] as (keyof T & string)[];
    if (!fields.length) return [];

    const lowerQuery = query.trim().toLowerCase();
    if (!lowerQuery) return [];
    if (lowerQuery.length < this.minQueryLength) return [];

    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    if (!uniqueQueryGrams.size) return [];

    const seenIds = new Set<CollectionItem["id"]>();
    const combined: T[] = [];

    for (const field of fields) {
      for (const item of this.searchFieldWithPreparedQuery(
        field,
        lowerQuery,
        uniqueQueryGrams,
      )) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          combined.push(item);
        }
      }
    }

    return combined;
  }

  /** Core search implementation for a single field. */
  private searchField(field: keyof T & string, query: string): T[] {
    const lowerQuery = query.trim().toLowerCase();
    if (!lowerQuery) return [];
    if (lowerQuery.length < this.minQueryLength) return [];

    const uniqueQueryGrams = buildIntersectionQueryGrams(lowerQuery);
    if (!uniqueQueryGrams.size) return [];

    return this.searchFieldWithPreparedQuery(
      field,
      lowerQuery,
      uniqueQueryGrams,
    );
  }

  private searchFieldWithPreparedQuery(
    field: keyof T & string,
    lowerQuery: string,
    uniqueQueryGrams: ReadonlySet<string>,
  ): T[] {
    const ngramMap = this.ngramIndexes.get(field as string);
    if (!ngramMap) return [];

    // -- Step 1: collect posting lists for each unique query gram --
    // Single loop replaces Array.from → Set → map → filter chain,
    // eliminating 3 intermediate array allocations.
    const postingLists: Set<number>[] = [];

    for (const queryGram of uniqueQueryGrams) {
      const postingList = ngramMap.get(queryGram);
      if (!postingList) return []; // gram absent → zero matches, bail out early
      postingLists.push(postingList);
    }

    // Sort so the smallest posting list comes first (best selectivity)
    postingLists.sort(
      (leftPostingList, rightPostingList) =>
        leftPostingList.size - rightPostingList.size,
    );

    // -- Step 2: intersect + verify in a single pass --
    // Index-based access avoids spread destructuring ([first, ...rest])
    // which would allocate an extra array.
    const smallestPostingList = postingLists[0];
    const totalPostingLists = postingLists.length;
    const matchedItems: T[] = [];

    for (const candidateIndex of smallestPostingList) {
      // Check remaining posting lists (O(1) Set lookup each)
      let isCandidate = true;
      for (let listIndex = 1; listIndex < totalPostingLists; listIndex++) {
        if (!postingLists[listIndex].has(candidateIndex)) {
          isCandidate = false;
          break;
        }
      }
      if (!isCandidate) continue;

      // Verify against the real string
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

  /** Check whether a trigram index exists for a field. */
  hasIndex(field: string): boolean {
    return this.ngramIndexes.has(field);
  }

  /** Free memory. */
  clear(): void {
    this.ngramIndexes.clear();
    this.data = [];
  }
}
