import { describe, expect, it } from "vitest";

import { indexLowerValue, intersectPostingLists } from "./ngram";

describe("intersectPostingLists", () => {
  it("returns matching indices for a single gram", () => {
    const ngramMap = new Map<string, Set<number>>();
    indexLowerValue(ngramMap, "hello", 0);
    indexLowerValue(ngramMap, "hello world", 1);

    const queryGrams = new Set(["hel"]);
    const normalizedValues = ["hello", "hello world"];

    const result = intersectPostingLists(
      ngramMap,
      queryGrams,
      normalizedValues,
      "hel",
    );
    expect(result).toEqual([0, 1]);
  });

  it("returns only the intersection of two grams", () => {
    const ngramMap = new Map<string, Set<number>>();
    indexLowerValue(ngramMap, "abcdef", 0);
    indexLowerValue(ngramMap, "abcxyz", 1);

    // "abc" is shared, "def" is only in item 0
    const queryGrams = new Set(["abc", "def"]);
    const normalizedValues = ["abcdef", "abcxyz"];

    const result = intersectPostingLists(
      ngramMap,
      queryGrams,
      normalizedValues,
      "abcdef",
    );
    expect(result).toEqual([0]);
  });

  it("returns empty when a gram is absent from the map", () => {
    const ngramMap = new Map<string, Set<number>>();
    indexLowerValue(ngramMap, "hello", 0);

    const queryGrams = new Set(["hel", "zzz"]);
    const normalizedValues = ["hello"];

    const result = intersectPostingLists(
      ngramMap,
      queryGrams,
      normalizedValues,
      "helzzz",
    );
    expect(result).toEqual([]);
  });

  it("excludes trigram false positives via confirm step", () => {
    const ngramMap = new Map<string, Set<number>>();
    // "abcde" has grams: "abc", "bcd", "cde"
    indexLowerValue(ngramMap, "abcde", 0);
    // "abcfg" has grams: "abc", "bcf", "cfg"
    indexLowerValue(ngramMap, "abcfg", 1);

    // Query "abcde" — gram "abc" matches both, but confirm step filters out item 1
    const queryGrams = new Set(["abc"]);
    const normalizedValues = ["abcde", "abcfg"];

    const result = intersectPostingLists(
      ngramMap,
      queryGrams,
      normalizedValues,
      "abcde",
    );
    expect(result).toEqual([0]);
  });

  it("works correctly with a single posting list (no swap needed)", () => {
    const ngramMap = new Map<string, Set<number>>();
    indexLowerValue(ngramMap, "test", 0);

    const queryGrams = new Set(["tes"]);
    const normalizedValues = ["test"];

    const result = intersectPostingLists(
      ngramMap,
      queryGrams,
      normalizedValues,
      "tes",
    );
    expect(result).toEqual([0]);
  });
});
