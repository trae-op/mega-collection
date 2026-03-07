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

  it("returns original data for empty/blank query and empty for absent gram", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
    });

    expect(engine.search("city", "")).toEqual(cityCards);
    expect(engine.search("city", "   ")).toEqual(cityCards);
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

  it("clearIndexes removes indexes but keeps data", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
    });
    engine.clearIndexes();

    expect(engine.search("Kyiv").map((item) => item.id)).toEqual([2]);
  });

  it("clearData removes stored data and indexes", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
    });

    engine.clearData();
    expect(engine.search("Kyiv")).toEqual([]);
  });

  it("getOriginData returns stored dataset", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
    });

    expect(engine.getOriginData()).toBe(cityCards);

    const nextCards: CardItem[] = [
      {
        id: 99,
        title: "Nina 2",
        description: "User from Paris",
        tag: "Even",
        city: "Paris",
      },
    ];

    engine.data(nextCards);
    expect(engine.getOriginData()).toBe(nextCards);

    engine.clearData();
    expect(engine.getOriginData()).toEqual([]);
  });

  it("data() replaces stored dataset without re-initializing engine", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city"],
    });

    const nextCards: CardItem[] = [
      {
        id: 11,
        title: "Liam 1",
        description: "User from London",
        tag: "Odd",
        city: "London",
      },
    ];

    expect(engine.search("city", "Kyiv").map((item) => item.id)).toEqual([2]);

    engine.data(nextCards);

    expect(engine.search("city", "Kyiv")).toEqual([]);
    expect(engine.search("city", "London").map((item) => item.id)).toEqual([
      11,
    ]);
  });

  it("supports chain usage", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city", "title"],
      minQueryLength: 2,
    });

    expect(() => engine.search("ky").clearIndexes().clearData()).not.toThrow();
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

type Order = {
  id: string;
  status: string;
};

type UserWithOrders = {
  id: string;
  name: string;
  city: string;
  age: number;
  orders: Order[];
};

const usersWithOrders: UserWithOrders[] = [
  {
    id: "1",
    name: "Tim",
    city: "New-York",
    age: 20,
    orders: [
      { id: "1", status: "pending" },
      { id: "2", status: "delivered" },
    ],
  },
  {
    id: "2",
    name: "Tom",
    city: "LA",
    age: 40,
    orders: [{ id: "3", status: "pending" }],
  },
  {
    id: "3",
    name: "Sara",
    city: "Chicago",
    age: 30,
    orders: [],
  },
];

describe("TextSearchEngine — nestedFields", () => {
  it("searches nested field by specific field path", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      fields: ["name", "city"],
      nestedFields: ["orders.status"],
      minQueryLength: 2,
    });

    const result = engine.search("orders.status", "pending");
    expect(result.map((u) => u.id)).toEqual(["1", "2"]);
  });

  it("searches nested field matching only one value", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      fields: ["name"],
      nestedFields: ["orders.status"],
    });

    const result = engine.search("orders.status", "delivered");
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  it("search(query) includes nested fields in all-fields search", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      fields: ["name"],
      nestedFields: ["orders.status"],
    });

    const result = engine.search("delivered");
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  it("deduplicates when item matches both flat and nested field", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      fields: ["name", "city"],
      nestedFields: ["orders.status"],
    });

    const result = engine.search("pending");
    const uniqueIds = new Set(result.map((u) => u.id));
    expect(uniqueIds.size).toBe(result.length);
  });

  it("returns empty for non-matching nested search", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    expect(engine.search("orders.status", "cancelled")).toEqual([]);
  });

  it("clearIndexes clears nested indexes; linear fallback works", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      fields: ["name"],
      nestedFields: ["orders.status"],
    });

    engine.clearIndexes();

    const result = engine.search("orders.status", "delivered");
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  it("clearData clears everything including nested", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    engine.clearData();
    expect(engine.search("orders.status", "pending")).toEqual([]);
  });

  it("data() rebuilds nested indexes for new dataset", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      fields: ["name"],
      nestedFields: ["orders.status"],
    });

    expect(engine.search("orders.status", "pending")).toHaveLength(2);

    const newUsers: UserWithOrders[] = [
      {
        id: "10",
        name: "Lia",
        city: "Berlin",
        age: 28,
        orders: [{ id: "10", status: "shipped" }],
      },
    ];

    engine.data(newUsers);

    expect(engine.search("orders.status", "pending")).toEqual([]);
    expect(engine.search("orders.status", "shipped").map((u) => u.id)).toEqual([
      "10",
    ]);
  });

  it("works without flat fields, only nestedFields", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    expect(engine.search("orders.status", "pending").map((u) => u.id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("skips items with empty nested collection", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    const result = engine.search("orders.status", "pending");
    expect(result.map((u) => u.id)).not.toContain("3");
  });

  it("linear fallback for all-fields search includes nested", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    engine.clearIndexes();

    const result = engine.search("delivered");
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  it("minQueryLength applies to nested field searches", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
      minQueryLength: 3,
    });

    expect(engine.search("orders.status", "pe")).toEqual(usersWithOrders);
    expect(engine.search("orders.status", "pen").map((u) => u.id)).toEqual([
      "1",
      "2",
    ]);
  });
});
