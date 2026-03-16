const MAXIMUM_NGRAM_LENGTH = 3;

/**
 * Minimum query length required to use the n-gram index directly.
 * Queries shorter than this fall back to a linear scan.
 */
export const MINIMUM_INDEXED_QUERY_LENGTH = MAXIMUM_NGRAM_LENGTH;
const MAXIMUM_QUERY_GRAMS_FOR_INTERSECTION = 12;

function extractQueryGrams(lowerInput: string): string[] {
  const gramLength = Math.min(MAXIMUM_NGRAM_LENGTH, lowerInput.length);
  const gramCount = lowerInput.length - gramLength + 1;
  const queryGrams = new Array<string>(gramCount);

  for (let index = 0; index < gramCount; index++) {
    queryGrams[index] = lowerInput.substring(index, index + gramLength);
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

export function buildIntersectionQueryGrams(
  lowerQuery: string,
): ReadonlySet<string> {
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

export function indexLowerValue(
  ngramMap: Map<string, Set<number>>,
  lowerValue: string,
  itemIndex: number,
): void {
  // O1: only store full-length (trigram) grams. Positions where fewer than
  // MAXIMUM_NGRAM_LENGTH characters remain are skipped; short queries use the
  // linear fallback instead of the index.
  const lastStart = lowerValue.length - MAXIMUM_NGRAM_LENGTH;
  for (let startIndex = 0; startIndex <= lastStart; startIndex++) {
    const ngram = lowerValue.substring(
      startIndex,
      startIndex + MAXIMUM_NGRAM_LENGTH,
    );
    getOrCreatePostingList(ngramMap, ngram).add(itemIndex);
  }
}

/**
 * Intersects posting lists for the given query grams and confirms each
 * candidate against the full normalizedValues string. Returns dataset indices
 * of confirmed matches.
 */
export function intersectPostingLists(
  ngramMap: Map<string, Set<number>>,
  uniqueQueryGrams: ReadonlySet<string>,
  normalizedValues: (string | undefined)[],
  lowerQuery: string,
): number[] {
  const postingLists: Set<number>[] = [];

  for (const queryGram of uniqueQueryGrams) {
    const postingList = ngramMap.get(queryGram);
    if (!postingList) return [];
    postingLists.push(postingList);
  }

  // O4: find smallest posting list and swap to front — avoids allocating a sort comparator.
  let minIdx = 0;
  for (let i = 1; i < postingLists.length; i++) {
    if (postingLists[i].size < postingLists[minIdx].size) minIdx = i;
  }
  if (minIdx !== 0) {
    const tmp = postingLists[0];
    postingLists[0] = postingLists[minIdx];
    postingLists[minIdx] = tmp;
  }

  const smallestPostingList = postingLists[0];
  const totalPostingLists = postingLists.length;
  const matchedIndices: number[] = [];

  for (const candidateIndex of smallestPostingList) {
    let isCandidate = true;
    for (let listIndex = 1; listIndex < totalPostingLists; listIndex++) {
      if (!postingLists[listIndex].has(candidateIndex)) {
        isCandidate = false;
        break;
      }
    }
    if (!isCandidate) continue;

    if (normalizedValues[candidateIndex]?.includes(lowerQuery)) {
      matchedIndices.push(candidateIndex);
    }
  }

  return matchedIndices;
}

export function removeLowerValue(
  ngramMap: Map<string, Set<number>>,
  lowerValue: string,
  itemIndex: number,
): void {
  // O1: mirrors indexLowerValue — only full-length grams were stored.
  const lastStart = lowerValue.length - MAXIMUM_NGRAM_LENGTH;
  for (let startIndex = 0; startIndex <= lastStart; startIndex++) {
    const ngram = lowerValue.substring(
      startIndex,
      startIndex + MAXIMUM_NGRAM_LENGTH,
    );
    const postingList = ngramMap.get(ngram);

    if (!postingList) {
      continue;
    }

    postingList.delete(itemIndex);

    if (postingList.size === 0) {
      ngramMap.delete(ngram);
    }
  }
}
