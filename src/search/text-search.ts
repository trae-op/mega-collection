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

const MINIMUM_TRIGRAM_LENGTH = 3;

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

  /** Build trigram index for one field. O(n·L). */
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

      // Deduplicate trigrams per item, then add to posting lists
      const uniqueTrigrams = new Set(extractTrigrams(rawValue));
      for (const trigram of uniqueTrigrams) {
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

    const lowerQuery = query.toLowerCase();

    // -- Step 1: get candidate indexes via trigram intersection --
    const queryTrigrams = Array.from(new Set(extractTrigrams(lowerQuery)));
    const postingLists = queryTrigrams
      .map((queryTrigram) => trigramMap.get(queryTrigram))
      .filter((postingList): postingList is Set<number> =>
        Boolean(postingList),
      );

    if (postingLists.length !== queryTrigrams.length) return [];

    postingLists.sort(
      (leftPostingList, rightPostingList) =>
        leftPostingList.size - rightPostingList.size,
    );

    // Intersect + verify in a single pass — no intermediate arrays
    const [smallestPostingList, ...remainingPostingLists] = postingLists;
    const remainingCount = remainingPostingLists.length;
    const matchedItems: T[] = [];

    for (const candidateIndex of smallestPostingList) {
      // Check all remaining posting lists (O(1) each)
      let isCandidate = true;
      for (let listIndex = 0; listIndex < remainingCount; listIndex++) {
        if (!remainingPostingLists[listIndex].has(candidateIndex)) {
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
