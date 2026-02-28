import { describe, expect, it } from "vitest";

import { TextSearchEngine } from "./text-search";

type CardItem = {
  id: number;
  title: string;
  description: string;
  tag: string;
  city?: string;
};

const cards: CardItem[] = Array.from({ length: 1000 }, (_, index) => ({
  id: index + 1,
  title: `Card #${index + 1}`,
  description: `This is card item number ${
    index + 1
  } in a virtualized list using react-window.`,
  tag: index % 2 === 0 ? "Even" : "Odd",
}));

const cityCards: CardItem[] = [
  {
    id: 1,
    title: "Noah 5",
    description: "User from Dnipro",
    tag: "Odd",
    city: "Dnipro",
  },
  {
    id: 2,
    title: "Mia 10",
    description: "User from Kyiv",
    tag: "Even",
    city: "Kyiv",
  },
];

describe("TextSearchEngine", () => {
  it("finds substrings and trims query whitespace", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cards,
      fields: ["title"],
    });

    const trimmed = engine.search("title", " 1 ");
    expect(trimmed.length).toBeGreaterThan(0);
    expect(trimmed).toEqual(engine.search("title", "1"));
  });

  it("exercises long-query subsampling path (>12 grams) and returns all matches", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cards,
      fields: ["description"],
    });

    expect(engine.search("description", "react-window")).toHaveLength(
      cards.length,
    );
  });

  it("returns empty for empty/blank query and for absent gram", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
    });

    expect(engine.search("city", "")).toEqual([]);
    expect(engine.search("city", "   ")).toEqual([]);
    expect(engine.search("city", "zzz")).toEqual([]);
  });

  it("returns empty when field is not indexed", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
    });

    expect(engine.search("title", "Noah")).toEqual([]);
  });

  it("minQueryLength blocks short queries by returning original data", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
      minQueryLength: 3,
    });

    expect(engine.search("city", "dn")).toEqual(cityCards);
    expect(engine.search("dn")).toEqual(cityCards);
    expect(engine.search("city", "dni")).toHaveLength(1);
  });

  it("clear removes all indexes; hasIndex returns false afterwards", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
    });
    engine.clear();

    expect(engine.search("Kyiv")).toEqual([]);
  });

  it("search(query) searches all fields and deduplicates matches", () => {
    const overlapping: CardItem[] = [
      {
        id: 1,
        title: "Kyiv city guide",
        description: "",
        tag: "",
        city: "Kyiv",
      },
      { id: 2, title: "Lviv guide", description: "", tag: "", city: "Lviv" },
    ];
    const engine = new TextSearchEngine<CardItem>({
      data: overlapping,
      fields: ["city", "title"],
    });

    const results = engine.search("Kyiv");
    expect(new Set(results.map((i) => i.id)).size).toBe(results.length);
    expect(results).toHaveLength(1);
  });

  it("works without fields in constructor via linear search fallback", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      minQueryLength: 2,
    });

    expect(engine.search("Kyiv").map((item) => item.id)).toEqual([2]);
    expect(engine.search("title", "Noah").map((item) => item.id)).toEqual([1]);
  });

  it("constructor with data and fields auto-builds index", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
    });
    expect(engine.search("city", "Dnipro")).toHaveLength(1);
  });
});
