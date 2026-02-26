import { beforeEach, describe, expect, it } from "vitest";

import { Indexer } from "./indexer";

type Product = {
  id: number;
  category: string;
  price: number;
  tag?: string | null;
};

const products: Product[] = [
  { id: 1, category: "electronics", price: 100 },
  { id: 2, category: "clothing", price: 50 },
  { id: 3, category: "electronics", price: 200 },
  { id: 4, category: "clothing", price: 80 },
  { id: 5, category: "food", price: 20 },
];

describe("Indexer", () => {
  let indexer: Indexer<Product>;

  beforeEach(() => {
    indexer = new Indexer<Product>();
  });

  it("should build an index and group items under the same value", () => {
    indexer.buildIndex(products, "category");

    expect(indexer.hasIndex("category")).toBe(true);
    expect(indexer.getByValue("category", "electronics")).toHaveLength(2);
  });

  it("should skip items with null or undefined values", () => {
    const data: Product[] = [
      { id: 1, category: "electronics", price: 100, tag: null },
      { id: 2, category: "clothing", price: 50, tag: undefined },
      { id: 3, category: "food", price: 20, tag: "sale" },
    ];
    indexer.buildIndex(data, "tag");

    expect(indexer.getByValue("tag", "sale")).toHaveLength(1);
    expect(indexer.getByValue("tag", null)).toHaveLength(0);
  });

  it("getByValue returns empty when field not indexed", () => {
    expect(indexer.getByValue("category", "electronics")).toEqual([]);
  });

  it("getByValues single value — fast path", () => {
    indexer.buildIndex(products, "category");

    const result = indexer.getByValues("category", ["electronics"]);
    expect(result).toHaveLength(2);
  });

  it("getByValues multiple values — union without duplicates", () => {
    indexer.buildIndex(products, "category");

    const result = indexer.getByValues("category", ["electronics", "clothing"]);
    expect(result).toHaveLength(4);
    const ids = result.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("getByValues returns empty when field not indexed", () => {
    expect(indexer.getByValues("category", ["electronics", "food"])).toEqual(
      [],
    );
  });

  it("clear removes all indexes", () => {
    indexer.buildIndex(products, "category");
    indexer.clear();

    expect(indexer.hasIndex("category")).toBe(false);
    expect(indexer.getByValue("category", "electronics")).toEqual([]);
  });

  it("getIndexMap returns map for indexed field and undefined otherwise", () => {
    indexer.buildIndex(products, "category");

    expect(indexer.getIndexMap("category")).toBeInstanceOf(Map);
    expect(indexer.getIndexMap("price")).toBeUndefined();
  });
});
