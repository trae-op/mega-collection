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
  description: `This is card item number ${index + 1} in a virtualized list using react-window.`,
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
  it("finds numeric substrings in long text fields", () => {
    const engine = new TextSearchEngine<CardItem>();
    engine.buildIndex(cards, "title");

    const matches = engine.search("title", "1");

    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((item) => item.title.includes("1"))).toBe(true);
  });

  it("trims query before searching", () => {
    const engine = new TextSearchEngine<CardItem>();
    engine.buildIndex(cards, "title");

    const exactMatches = engine.search("title", "1");
    const paddedMatches = engine.search("title", " 1 ");

    expect(paddedMatches).toEqual(exactMatches);
  });

  it("keeps indexed-path behavior for longer queries", () => {
    const engine = new TextSearchEngine<CardItem>();
    engine.buildIndex(cards, "description");

    const matches = engine.search("description", "virtualized");

    expect(matches.length).toBe(cards.length);
  });

  it("supports search from the first character", () => {
    const engine = new TextSearchEngine<CardItem>();
    engine.buildIndex(cityCards, "city");

    const matches = engine.search("city", "d");

    expect(matches).toHaveLength(1);
    expect(matches[0].city).toBe("Dnipro");
  });

  it("supports two-character queries", () => {
    const engine = new TextSearchEngine<CardItem>();
    engine.buildIndex(cityCards, "city");

    const matches = engine.search("city", "dn");

    expect(matches).toHaveLength(1);
    expect(matches[0].city).toBe("Dnipro");
  });
});
