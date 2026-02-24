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

export interface TextSearchEngineOptions {
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

  /** Reference to the full dataset (set once via `buildIndex`). */
  private data: T[] = [];

  /** Minimum query length before the engine executes a search. */
  private readonly minQueryLength: number;

  constructor(options: TextSearchEngineOptions = {}) {
    this.minQueryLength = options.minQueryLength ?? 1;
  }

  /**
   * Build n-gram index (1..3 chars) for one field. O(n·L).
   *
   * Trigram extraction is inlined to avoid allocating a temporary array
   * and a deduplication Set per item.  Posting lists are `Set<number>`,
   * so duplicate `.add()` calls for the same itemIndex are no-ops — we
   * get correctness without per-item deduplication overhead.
   *
   * For 10 M+ items this eliminates ~20 M transient object allocations
   * and dramatically reduces GC pressure.
   */
  buildIndex(data: T[], field: keyof T & string): this {
    this.data = data;

    const ngramMap = new Map<string, Set<number>>();

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const rawValue = data[itemIndex][field];
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

    this.ngramIndexes.set(field as string, ngramMap);
    return this;
  }

  /**
   * Search items by substring (contains) using the trigram index.
   * Returns matching items.
   */
  search(field: keyof T & string, query: string): T[] {
    const ngramMap = this.ngramIndexes.get(field as string);
    if (!ngramMap) return [];

    const lowerQuery = query.trim().toLowerCase();
    if (!lowerQuery) return [];
    if (lowerQuery.length < this.minQueryLength) return [];

    // -- Step 1: collect posting lists for each unique query gram --
    // Single loop replaces Array.from → Set → map → filter chain,
    // eliminating 3 intermediate array allocations.
    const uniqueQueryGrams = new Set(extractQueryGrams(lowerQuery));
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
