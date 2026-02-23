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

/** Extract all trigrams from a lowercased string. */
function extractTrigrams(input: string): string[] {
  const lower = input.toLowerCase();
  if (lower.length < 3) return [lower]; // short strings become a single "gram"
  const trigrams: string[] = [];
  for (let index = 0; index <= lower.length - 3; index++) {
    trigrams.push(lower.substring(index, index + 3));
  }
  return trigrams;
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

      const trigrams = extractTrigrams(rawValue);
      for (
        let trigramIndex = 0;
        trigramIndex < trigrams.length;
        trigramIndex++
      ) {
        const trigram = trigrams[trigramIndex];
        let itemIndexes = trigramMap.get(trigram);
        if (!itemIndexes) {
          itemIndexes = new Set<number>();
          trigramMap.set(trigram, itemIndexes);
        }
        itemIndexes.add(itemIndex);
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
    const queryGrams = extractTrigrams(lowerQuery);

    let candidateSet: Set<number> | null = null;

    for (const queryTrigram of queryGrams) {
      const postingList = trigramMap.get(queryTrigram);
      if (!postingList) return []; // trigram not found → zero results

      if (candidateSet === null) {
        candidateSet = new Set(postingList);
      } else {
        // Intersect: keep only indexes present in both sets
        for (const candidateIndex of candidateSet) {
          if (!postingList.has(candidateIndex)) {
            candidateSet.delete(candidateIndex);
          }
        }
      }

      if (candidateSet.size === 0) return [];
    }

    if (!candidateSet) return [];

    // -- Step 2: verify candidates against the real string --
    const results: T[] = [];
    for (const itemIndex of candidateSet) {
      const value = (this.data[itemIndex][field] as string).toLowerCase();

      if (value.includes(lowerQuery)) {
        results.push(this.data[itemIndex]);
      }
    }

    return results;
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
