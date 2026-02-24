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

  describe("constructor shorthand (data + fields)", () => {
    it("builds indexes automatically when data and fields are provided", () => {
      const engine = new TextSearchEngine<CardItem>({
        data: cityCards,
        fields: ["city"],
      });

      expect(engine.hasIndex("city")).toBe(true);
    });

    it("search(query) returns results across all indexed fields", () => {
      const engine = new TextSearchEngine<CardItem>({
        data: cityCards,
        fields: ["city", "title"],
      });

      // "Kyiv" is only in city; "Noah" is only in title
      const byCityQuery = engine.search("Kyiv");
      const byTitleQuery = engine.search("Noah");

      expect(byCityQuery).toHaveLength(1);
      expect(byCityQuery[0].city).toBe("Kyiv");

      expect(byTitleQuery).toHaveLength(1);
      expect(byTitleQuery[0].title).toBe("Noah 5");
    });

    it("search(query) deduplicates items that match multiple fields", () => {
      const overlappingCards: CardItem[] = [
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
        data: overlappingCards,
        fields: ["city", "title"],
      });

      // Item 1 matches both "city" and "title" for query "Kyiv"
      const results = engine.search("Kyiv");
      const uniqueIds = new Set(results.map((item) => item.id));

      expect(uniqueIds.size).toBe(results.length);
    });

    it("buildIndex(field) reuses constructor data", () => {
      const engine = new TextSearchEngine<CardItem>({ data: cityCards });
      engine.buildIndex("city");

      const matches = engine.search("city", "Dnipro");
      expect(matches).toHaveLength(1);
    });

    it("buildIndex(field) throws when no dataset is in memory", () => {
      const engine = new TextSearchEngine<CardItem>();
      // No data supplied — field-only shorthand must reject.
      let caughtMessage = "";
      try {
        engine.buildIndex("title");
      } catch (err) {
        caughtMessage = err instanceof Error ? err.message : String(err);
      }
      expect(caughtMessage).toContain("no dataset in memory");
    });
  });
});
