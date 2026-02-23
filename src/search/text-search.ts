/**
 * TextSearchEngine — fast substring search on 10 M+ string fields.
 *
 * Strategy:
 *  1. **Trigram index** — every string is split into overlapping 3-character
 *     grams.  Each trigram maps to a Set of item indexes.  At query time we
 *     intersect the trigram posting lists to get *candidates*, then verify
 *     with `String.includes` (which is very fast on a small candidate set).
 *
 *  Building the trigram index is O(n·L) where L is average string length.
 *  Query time is roughly O(|candidates| + |postingList intersections|).
 */

import { CollectionItem } from "../types";

const MINIMUM_TRIGRAM_LENGTH = 1;

/** Extract all trigrams from a lowercased string. */
function extractTrigrams(input: string): string[] {
  const lower = input.toLowerCase();
  if (lower.length < MINIMUM_TRIGRAM_LENGTH) return [lower];
  const trigramCount = lower.length - MINIMUM_TRIGRAM_LENGTH + 1;
  const trigrams = new Array<string>(trigramCount);
  for (let index = 0; index < trigramCount; index++) {
    trigrams[index] = lower.substring(index, index + MINIMUM_TRIGRAM_LENGTH);
  }
  return trigrams;
}

function getOrCreatePostingList(
  trigramMap: Map<string, Set<number>>,
  trigram: string,
): Set<number> {
  const existingPostingList = trigramMap.get(trigram);
  if (existingPostingList) return existingPostingList;

  const newPostingList = new Set<number>();
  trigramMap.set(trigram, newPostingList);
  return newPostingList;
}

export class TextSearchEngine<T extends CollectionItem> {
  /**
   * field → trigram → Set<index in data[]>
   * We store *indexes into the data array* (not the objects) to save memory.
   */
  private trigramIndexes = new Map<string, Map<string, Set<number>>>();

  /** Reference to the full dataset (set once via `buildIndex`). */
  private data: T[] = [];

  /**
   * Build trigram index for one field. O(n·L).
   *
   * Trigram extraction is inlined to avoid allocating a temporary array
   * and a deduplication Set per item.  Posting lists are `Set<number>`,
   * so duplicate `.add()` calls for the same itemIndex are no-ops — we
   * get correctness without per-item deduplication overhead.
   *
   * For 10 M+ items this eliminates ~20 M transient object allocations
   * and dramatically reduces GC pressure.
   */
  buildIndex(data: T[], field: keyof T & string): void {
    this.data = data;

    const trigramMap = new Map<string, Set<number>>();

    for (
      let itemIndex = 0, dataLength = data.length;
      itemIndex < dataLength;
      itemIndex++
    ) {
      const rawValue = data[itemIndex][field];
      if (typeof rawValue !== "string") continue;

      const lower = rawValue.toLowerCase();

      // Short strings produce a single "trigram" (the whole string)
      if (lower.length < MINIMUM_TRIGRAM_LENGTH) {
        getOrCreatePostingList(trigramMap, lower).add(itemIndex);
        continue;
      }

      // Inline trigram extraction — no intermediate array or Set created.
      // Set.add is idempotent, so duplicate trigrams within one string
      // are harmless and far cheaper than per-item Set allocation.
      const trigramCount = lower.length - MINIMUM_TRIGRAM_LENGTH + 1;
      for (let i = 0; i < trigramCount; i++) {
        const trigram = lower.substring(i, i + MINIMUM_TRIGRAM_LENGTH);
        getOrCreatePostingList(trigramMap, trigram).add(itemIndex);
      }
    }

    this.trigramIndexes.set(field as string, trigramMap);
  }

  /**
   * Search items by substring (contains) using the trigram index.
   * Returns matching items.
   */
  search(field: keyof T & string, query: string): T[] {
    const trigramMap = this.trigramIndexes.get(field as string);
    if (!trigramMap) return [];

    const lowerQuery = query.trim().toLowerCase();
    if (!lowerQuery) return [];

    // Trigram index cannot directly serve queries shorter than 3 chars.
    // Fall back to linear scan + includes verification for correctness.
    if (lowerQuery.length < MINIMUM_TRIGRAM_LENGTH) {
      const matchedItems: T[] = [];
      for (
        let itemIndex = 0, dataLength = this.data.length;
        itemIndex < dataLength;
        itemIndex++
      ) {
        const fieldValue = this.data[itemIndex][field];
        if (
          typeof fieldValue === "string" &&
          fieldValue.toLowerCase().includes(lowerQuery)
        ) {
          matchedItems.push(this.data[itemIndex]);
        }
      }
      return matchedItems;
    }

    // -- Step 1: collect posting lists for each unique query trigram --
    // Single loop replaces Array.from → Set → map → filter chain,
    // eliminating 3 intermediate array allocations.
    const uniqueQueryTrigrams = new Set(extractTrigrams(lowerQuery));
    const postingLists: Set<number>[] = [];

    for (const trigram of uniqueQueryTrigrams) {
      const postingList = trigramMap.get(trigram);
      if (!postingList) return []; // trigram absent → zero matches, bail out early
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
    return this.trigramIndexes.has(field);
  }

  /** Free memory. */
  clear(): void {
    this.trigramIndexes.clear();
    this.data = [];
  }
}
