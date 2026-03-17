const MINIMUM_NGRAM_LENGTH = 2;
const MAXIMUM_NGRAM_LENGTH = 3;

/**
 * Minimum query length required to use the n-gram index directly.
 * Queries shorter than this fall back to a linear scan.
 */
export const MINIMUM_INDEXED_QUERY_LENGTH = MINIMUM_NGRAM_LENGTH;
const MAXIMUM_QUERY_GRAMS_FOR_INTERSECTION = 12;

type IntersectPostingListsOptions = {
  restrictionLookup?: Uint8Array | null;
  take?: number;
};

type IntersectPostingListsInCandidatesOptions = {
  candidateIndices: readonly number[];
  restrictionLookup?: Uint8Array | null;
  take?: number;
};

export type IntersectionPlan = {
  smallestPostingList: ReadonlySet<number>;
  matches: (candidateIndex: number) => boolean;
};

function sortPostingListsBySize(postingLists: Set<number>[]): void {
  for (let left = 0; left < postingLists.length - 1; left++) {
    let minIndex = left;

    for (let right = left + 1; right < postingLists.length; right++) {
      if (postingLists[right].size < postingLists[minIndex].size) {
        minIndex = right;
      }
    }

    if (minIndex !== left) {
      const next = postingLists[left];
      postingLists[left] = postingLists[minIndex];
      postingLists[minIndex] = next;
    }
  }
}

function collectPostingLists(
  ngramMap: Map<string, Set<number>>,
  uniqueQueryGrams: ReadonlySet<string>,
): Set<number>[] | null {
  const postingLists: Set<number>[] = [];

  for (const queryGram of uniqueQueryGrams) {
    const postingList = ngramMap.get(queryGram);
    if (!postingList) {
      return null;
    }

    postingLists.push(postingList);
  }

  sortPostingListsBySize(postingLists);
  return postingLists;
}

function matchesPostingLists(
  candidateIndex: number,
  postingLists: readonly Set<number>[],
): boolean {
  for (let listIndex = 0; listIndex < postingLists.length; listIndex++) {
    if (!postingLists[listIndex].has(candidateIndex)) {
      return false;
    }
  }

  return true;
}

export function createIntersectionPlan(
  ngramMap: Map<string, Set<number>>,
  uniqueQueryGrams: ReadonlySet<string>,
  normalizedValues: (string | undefined)[],
  lowerQuery: string,
): IntersectionPlan | null {
  const postingLists = collectPostingLists(ngramMap, uniqueQueryGrams);
  if (postingLists === null) {
    return null;
  }

  const smallestPostingList = postingLists[0];

  return {
    smallestPostingList,
    matches: (candidateIndex: number) =>
      smallestPostingList.has(candidateIndex) &&
      matchesPostingLists(candidateIndex, postingLists) &&
      Boolean(normalizedValues[candidateIndex]?.includes(lowerQuery)),
  };
}

function extractQueryGrams(lowerInput: string): string[] {
  const gramLength = Math.min(
    MAXIMUM_NGRAM_LENGTH,
    Math.max(MINIMUM_NGRAM_LENGTH, lowerInput.length),
  );
  const gramCount = lowerInput.length - gramLength + 1;
  const queryGrams = new Array<string>(gramCount);

  for (let index = 0; index < gramCount; index++) {
    queryGrams[index] = lowerInput.substring(index, index + gramLength);
  }

  return queryGrams;
}

export const MINIMUM_SHORT_QUERY_INDEX_LENGTH = MINIMUM_NGRAM_LENGTH;

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
  const longestGramLength = Math.min(MAXIMUM_NGRAM_LENGTH, lowerValue.length);

  for (
    let gramLength = MINIMUM_NGRAM_LENGTH;
    gramLength <= longestGramLength;
    gramLength++
  ) {
    const lastStart = lowerValue.length - gramLength;

    for (let startIndex = 0; startIndex <= lastStart; startIndex++) {
      const ngram = lowerValue.substring(startIndex, startIndex + gramLength);
      getOrCreatePostingList(ngramMap, ngram).add(itemIndex);
    }
  }
}

export function estimateIntersectionCandidateCount(
  ngramMap: Map<string, Set<number>>,
  uniqueQueryGrams: ReadonlySet<string>,
): number {
  let smallestPostingListSize = Number.POSITIVE_INFINITY;

  for (const queryGram of uniqueQueryGrams) {
    const postingList = ngramMap.get(queryGram);
    if (!postingList) {
      return 0;
    }

    if (postingList.size < smallestPostingListSize) {
      smallestPostingListSize = postingList.size;
    }
  }

  return Number.isFinite(smallestPostingListSize) ? smallestPostingListSize : 0;
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
  options: IntersectPostingListsOptions = {},
): number[] {
  const { restrictionLookup = null, take = Number.POSITIVE_INFINITY } = options;
  const plan = createIntersectionPlan(
    ngramMap,
    uniqueQueryGrams,
    normalizedValues,
    lowerQuery,
  );
  if (plan === null) {
    return [];
  }

  const matchedIndices: number[] = [];

  for (const candidateIndex of plan.smallestPostingList) {
    if (restrictionLookup !== null && !restrictionLookup[candidateIndex]) {
      continue;
    }

    if (!plan.matches(candidateIndex)) continue;

    matchedIndices.push(candidateIndex);

    if (matchedIndices.length >= take) {
      break;
    }
  }

  return matchedIndices;
}

export function intersectPostingListsInCandidates(
  ngramMap: Map<string, Set<number>>,
  uniqueQueryGrams: ReadonlySet<string>,
  normalizedValues: (string | undefined)[],
  lowerQuery: string,
  options: IntersectPostingListsInCandidatesOptions,
): number[] {
  const {
    candidateIndices,
    restrictionLookup = null,
    take = Number.POSITIVE_INFINITY,
  } = options;

  if (candidateIndices.length === 0) {
    return [];
  }

  const plan = createIntersectionPlan(
    ngramMap,
    uniqueQueryGrams,
    normalizedValues,
    lowerQuery,
  );
  if (plan === null) {
    return [];
  }

  const matchedIndices: number[] = [];
  const shouldIterateCandidates =
    restrictionLookup === null ||
    candidateIndices.length <= plan.smallestPostingList.size;

  if (shouldIterateCandidates) {
    for (
      let candidateOffset = 0;
      candidateOffset < candidateIndices.length;
      candidateOffset++
    ) {
      const candidateIndex = candidateIndices[candidateOffset];

      if (!plan.matches(candidateIndex)) {
        continue;
      }

      matchedIndices.push(candidateIndex);

      if (matchedIndices.length >= take) {
        break;
      }
    }

    return matchedIndices;
  }

  for (const candidateIndex of plan.smallestPostingList) {
    if (!restrictionLookup[candidateIndex]) {
      continue;
    }

    if (!plan.matches(candidateIndex)) {
      continue;
    }

    matchedIndices.push(candidateIndex);

    if (matchedIndices.length >= take) {
      break;
    }
  }

  return matchedIndices;
}

export function removeLowerValue(
  ngramMap: Map<string, Set<number>>,
  lowerValue: string,
  itemIndex: number,
): void {
  const longestGramLength = Math.min(MAXIMUM_NGRAM_LENGTH, lowerValue.length);

  for (
    let gramLength = MINIMUM_NGRAM_LENGTH;
    gramLength <= longestGramLength;
    gramLength++
  ) {
    const lastStart = lowerValue.length - gramLength;

    for (let startIndex = 0; startIndex <= lastStart; startIndex++) {
      const ngram = lowerValue.substring(startIndex, startIndex + gramLength);
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
}
