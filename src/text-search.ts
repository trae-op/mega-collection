/**
 * TextSearchEngine — fast substring and prefix search on 10 M+ string fields.
 *
 * Strategy:
 *  1. **Trigram index** — every string is split into overlapping 3-character
 *     grams.  Each trigram maps to a Set of item indexes.  At query time we
 *     intersect the trigram posting lists to get *candidates*, then verify
 *     with `String.includes` (which is very fast on a small candidate set).
 *
 *  2. **Exact search** falls back to the Indexer (O(1) hash lookup).
 *
 *  3. **Prefix search** uses the trigram index for candidates, then verifies
 *     with `String.startsWith`.
 *
 *  Building the trigram index is O(n·L) where L is average string length.
 *  Query time is roughly O(|candidates| + |postingList intersections|).
 */

import { CollectionItem, TextSearchOptions } from "./types";

/** Extract all trigrams from a lowercased string. */
function extractTrigrams(s: string): string[] {
  const lower = s.toLowerCase();
  if (lower.length < 3) return [lower]; // short strings become a single "gram"
  const grams: string[] = [];
  for (let i = 0; i <= lower.length - 3; i++) {
    grams.push(lower.substring(i, i + 3));
  }
  return grams;
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

    const triMap = new Map<string, Set<number>>();

    for (let i = 0, len = data.length; i < len; i++) {
      const raw = data[i][field];
      if (typeof raw !== "string") continue;

      const grams = extractTrigrams(raw);
      for (let g = 0; g < grams.length; g++) {
        const gram = grams[g];
        let set = triMap.get(gram);
        if (!set) {
          set = new Set<number>();
          triMap.set(gram, set);
        }
        set.add(i);
      }
    }

    this.trigramIndexes.set(field as string, triMap);
  }

  /**
   * Search items by substring (contains) using the trigram index.
   * Returns matching items.
   */
  search(
    field: keyof T & string,
    query: string,
    options: TextSearchOptions = {},
  ): T[] {
    const { mode = "contains", limit = Infinity } = options;
    const triMap = this.trigramIndexes.get(field as string);
    if (!triMap) return [];

    const lowerQuery = query.toLowerCase();

    // -- Step 1: get candidate indexes via trigram intersection --
    const queryGrams = extractTrigrams(lowerQuery);

    let candidateSet: Set<number> | null = null;

    for (const gram of queryGrams) {
      const posting = triMap.get(gram);
      if (!posting) return []; // trigram not found → zero results

      if (candidateSet === null) {
        candidateSet = new Set(posting);
      } else {
        // Intersect: keep only indexes present in both sets
        for (const idx of candidateSet) {
          if (!posting.has(idx)) {
            candidateSet.delete(idx);
          }
        }
      }

      if (candidateSet.size === 0) return [];
    }

    if (!candidateSet) return [];

    // -- Step 2: verify candidates against the real string --
    const results: T[] = [];
    for (const idx of candidateSet) {
      const value = (this.data[idx][field] as string).toLowerCase();

      let match = false;
      if (mode === "contains") {
        match = value.includes(lowerQuery);
      } else if (mode === "prefix") {
        match = value.startsWith(lowerQuery);
      } else {
        // exact
        match = value === lowerQuery;
      }

      if (match) {
        results.push(this.data[idx]);
        if (results.length >= limit) break;
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
