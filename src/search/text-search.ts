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

    data.forEach((item, itemIndex) => {
      const rawValue = item[field];
      if (typeof rawValue !== "string") return;

      // Process item's own derived trigrams (per-item sub-data, not a separate collection)
      const uniqueTrigrams = new Set(extractTrigrams(rawValue));
      uniqueTrigrams.forEach((trigram) => {
        getOrCreatePostingList(trigramMap, trigram).add(itemIndex);
      });
    });

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

    // Intersect: filter smallest posting list by O(1) Set.has in all remaining lists
    const [smallestPostingList, ...remainingPostingLists] = postingLists;
    const candidateIndexes = Array.from(smallestPostingList).filter(
      (candidateIndex) =>
        remainingPostingLists.every((postingList) =>
          postingList.has(candidateIndex),
        ),
    );

    if (candidateIndexes.length === 0) return [];

    // -- Step 2: verify candidates against the real string --
    return candidateIndexes
      .filter((itemIndex) => {
        const fieldValue = this.data[itemIndex][field];
        return (
          typeof fieldValue === "string" &&
          fieldValue.toLowerCase().includes(lowerQuery)
        );
      })
      .map((itemIndex) => this.data[itemIndex]);
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
