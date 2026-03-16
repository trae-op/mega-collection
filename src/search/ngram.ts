const MAXIMUM_NGRAM_LENGTH = 3;

/**
 * Minimum query length required to use the n-gram index directly.
 * Queries shorter than this fall back to a linear scan.
 */
export const MINIMUM_INDEXED_QUERY_LENGTH = MAXIMUM_NGRAM_LENGTH;
const MAXIMUM_QUERY_GRAMS_FOR_INTERSECTION = 12;

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
