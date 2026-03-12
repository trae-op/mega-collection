const MAXIMUM_NGRAM_LENGTH = 3;
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
  for (
    let startIndex = 0, lowerLength = lowerValue.length;
    startIndex < lowerLength;
    startIndex++
  ) {
    const remainingLength = lowerLength - startIndex;
    const maxLengthAtPosition = Math.min(MAXIMUM_NGRAM_LENGTH, remainingLength);

    for (let gramLength = 1; gramLength <= maxLengthAtPosition; gramLength++) {
      const ngram = lowerValue.substring(startIndex, startIndex + gramLength);
      getOrCreatePostingList(ngramMap, ngram).add(itemIndex);
    }
  }
}

export function removeLowerValue(
  ngramMap: Map<string, Set<number>>,
  lowerValue: string,
  itemIndex: number,
): void {
  for (
    let startIndex = 0, lowerLength = lowerValue.length;
    startIndex < lowerLength;
    startIndex++
  ) {
    const remainingLength = lowerLength - startIndex;
    const maxLengthAtPosition = Math.min(MAXIMUM_NGRAM_LENGTH, remainingLength);

    for (let gramLength = 1; gramLength <= maxLengthAtPosition; gramLength++) {
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
