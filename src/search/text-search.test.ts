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

  it("add() appends new items to indexed flat fields", () => {
    const dataset = cityCards.map((card) => ({ ...card }));
    const engine = new TextSearchEngine<CardItem>({
      data: dataset,
      fields: ["city"],
    });

    engine.add([
      {
        id: 3,
        title: "Nina 2",
        description: "User from Paris",
        tag: "Odd",
        city: "Paris",
      },
    ]);

    expect(engine.search("city", "Paris").map((item) => item.id)).toEqual([3]);
  });

  it("add() treats an empty batch as a no-op", () => {
    const dataset = cityCards.map((card) => ({ ...card }));
    const engine = new TextSearchEngine<CardItem>({
      data: dataset,
      fields: ["city"],
    });

    engine.add([]);

    expect(engine.getOriginData()).toBe(dataset);
    expect(engine.search("city", "Kyiv").map((item) => item.id)).toEqual([2]);
  });

  it("update() refreshes indexed flat search data without replacing the dataset", () => {
    const dataset = cityCards.map((card) => ({ ...card }));
    const engine = new TextSearchEngine<CardItem>({
      data: dataset,
      fields: ["city"],
    });

    engine.update({
      field: "id",
      data: {
        id: 2,
        title: "Daria 1",
        description: "User from Paris",
        tag: "Even",
        city: "Paris",
      },
    });

    expect(engine.getOriginData()).toBe(dataset);
    expect(engine.search("city", "Kyiv")).toEqual([]);
    expect(engine.search("city", "Paris").map((item) => item.id)).toEqual([2]);
  });

  it("add() does not rebuild cleared indexes and keeps linear fallback working", () => {
    const dataset = cityCards.map((card) => ({ ...card }));
    const engine = new TextSearchEngine<CardItem>({
      data: dataset,
      fields: ["city"],
    });

    engine.clearIndexes();
    engine.add([
      {
        id: 3,
        title: "Nina 2",
        description: "User from Paris",
        tag: "Odd",
        city: "Paris",
      },
    ]);

    expect(engine.search("city", "Paris").map((item) => item.id)).toEqual([3]);
  });

  it("returns a plain array result", () => {
    const engine = new TextSearchEngine<CardItem>({
      data: cityCards,
      fields: ["city", "title"],
      minQueryLength: 2,
    });

    const result = engine.search("ky");

    expect(result.map((item) => item.id)).toEqual([2]);
    expect("search" in result).toBe(false);
    expect("clearIndexes" in result).toBe(false);

    engine.clearIndexes().clearData();
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

  it("does not match across separate nested values", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    expect(engine.search("orders.status", "pendingdelivered")).toEqual([]);
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

  it("clearIndexes clears nested indexes and keeps linear fallback working", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    engine.clearIndexes();

    expect(
      engine.search("orders.status", "delivered").map((u) => u.id),
    ).toEqual(["1"]);
  });

  it("data() rebuilds nested indexes for a new dataset", () => {
    const engine = new TextSearchEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    const nextUsers: UserWithOrders[] = [
      {
        id: "10",
        name: "Lia",
        city: "Berlin",
        age: 28,
        orders: [{ id: "10", status: "shipped" }],
      },
    ];

    engine.data(nextUsers);

    expect(engine.search("orders.status", "pending")).toEqual([]);
    expect(engine.search("orders.status", "shipped").map((u) => u.id)).toEqual([
      "10",
    ]);
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

  it("add() updates nested search indexes incrementally", () => {
    const dataset = usersWithOrders.map((user) => ({
      ...user,
      orders: user.orders.map((order) => ({ ...order })),
    }));
    const engine = new TextSearchEngine<UserWithOrders>({
      data: dataset,
      fields: ["name"],
      nestedFields: ["orders.status"],
    });

    engine.add([
      {
        id: "10",
        name: "Lia",
        city: "Berlin",
        age: 28,
        orders: [{ id: "10", status: "shipped" }],
      },
    ]);

    expect(
      engine.search("orders.status", "shipped").map((user) => user.id),
    ).toEqual(["10"]);
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

describe("TextSearchEngine — filterByPreviousResult", () => {
  type Person = { id: number; name: string; city: string };

  const people: Person[] = [
    { id: 1, name: "John", city: "New York" },
    { id: 2, name: "Johnny", city: "Boston" },
    { id: 3, name: "Joseph", city: "Chicago" },
    { id: 4, name: "Tim", city: "Denver" },
    { id: 5, name: "Timothy", city: "Seattle" },
  ];

  it("narrows subsequent search to previous result when query includes prior query", () => {
    const engine = new TextSearchEngine<Person>({
      data: people,
      fields: ["name"],
      filterByPreviousResult: true,
    });

    const first = engine.search("name", "jo");
    expect(first.map((p) => p.id)).toEqual([1, 2, 3]);

    const second = engine.search("name", "joh");
    expect(second.map((p) => p.id)).toEqual([1, 2]);
    expect(first.length).toBeGreaterThan(second.length);
  });

  it("resets to full dataset when query does not narrow previous", () => {
    const engine = new TextSearchEngine<Person>({
      data: people,
      fields: ["name"],
      filterByPreviousResult: true,
    });

    engine.search("name", "jo");
    const result = engine.search("name", "tim");
    expect(result.map((p) => p.id)).toEqual([4, 5]);
  });

  it("clears previousResult on add()", () => {
    const engine = new TextSearchEngine<Person>({
      data: people.map((p) => ({ ...p })),
      fields: ["name"],
      filterByPreviousResult: true,
    });

    engine.search("name", "jo");

    engine.add([{ id: 6, name: "Jordan", city: "Miami" }]);

    const result = engine.search("name", "joh");
    expect(result.map((p) => p.id)).toEqual([1, 2]);
  });

  it("clears previousResult on update()", () => {
    const engine = new TextSearchEngine<Person>({
      data: people.map((p) => ({ ...p })),
      fields: ["name"],
      filterByPreviousResult: true,
    });

    engine.search("name", "jo");

    engine.update({
      field: "id",
      data: { id: 3, name: "Thomas", city: "Chicago" },
    });

    const result = engine.search("name", "joh");
    expect(result.map((p) => p.id)).toEqual([1, 2]);
  });

  it("clears previousResult on data()", () => {
    const engine = new TextSearchEngine<Person>({
      data: people,
      fields: ["name"],
      filterByPreviousResult: true,
    });

    engine.search("name", "jo");

    const newData: Person[] = [
      { id: 10, name: "Jennifer", city: "Austin" },
      { id: 11, name: "Tim", city: "Houston" },
    ];
    engine.data(newData);

    const result = engine.search("name", "jen");
    expect(result.map((p) => p.id)).toEqual([10]);
  });

  it("resetSearchState() clears previous result manually", () => {
    const engine = new TextSearchEngine<Person>({
      data: people,
      fields: ["name"],
      filterByPreviousResult: true,
    });

    engine.search("name", "jo");
    engine.resetSearchState();

    const result = engine.search("name", "joh");
    expect(result.map((p) => p.id)).toEqual([1, 2]);
  });

  it("resetSearchState() is chainable", () => {
    const engine = new TextSearchEngine<Person>({
      data: people,
      fields: ["name"],
      filterByPreviousResult: true,
    });

    expect(engine.resetSearchState()).toBe(engine);
  });

  it("filterByPreviousResult: false (default) always searches full dataset", () => {
    const engine = new TextSearchEngine<Person>({
      data: people,
      fields: ["name"],
    });

    engine.search("name", "jo");
    const result = engine.search("name", "joh");
    expect(result.map((p) => p.id)).toEqual([1, 2]);
    expect(engine.getOriginData()).toHaveLength(people.length);
  });

  it("all-fields search narrows using previousResult on subsequent queries", () => {
    const engine = new TextSearchEngine<Person>({
      data: people,
      fields: ["name", "city"],
      filterByPreviousResult: true,
    });

    const first = engine.search("jo");
    expect(first.length).toBeGreaterThan(0);

    const second = engine.search("joh");
    for (const item of second) {
      expect(first).toContain(item);
    }
  });
});

// ─── Tests added per PLAN.md §4 ───────────────────────────────────────────────

describe("TextSearchEngine — O2: searchAllFieldsLinear uses indexed fields", () => {
  type ItemWithSecret = { id: number; name: string; secret: string };

  it("T1: linear scan checks only indexed fields, not all object keys", () => {
    const items: ItemWithSecret[] = [
      { id: 1, name: "Alice", secret: "hidden" },
      { id: 2, name: "Bob", secret: "also-hidden" },
    ];
    const engine = new TextSearchEngine<ItemWithSecret>({
      data: items,
      fields: ["name"],
    });
    // clearIndexes forces the all-fields linear path
    engine.clearIndexes();

    // "hidden" only exists in the non-indexed "secret" field → must not match
    expect(engine.search("hidden")).toEqual([]);
    // "Alice" is in the indexed "name" field → must match
    expect(engine.search("Alice")).toHaveLength(1);
  });

  it("T9: no-index linear scan skips non-string fields without throwing", () => {
    type MixedItem = { id: number; name: string; count: number; flag: boolean };
    const items: MixedItem[] = [
      { id: 1, name: "Alice", count: 5, flag: true },
      { id: 2, name: "Bob", count: 10, flag: false },
    ];
    const engine = new TextSearchEngine<MixedItem>({ data: items });

    expect(() => engine.search("Alice")).not.toThrow();
    expect(engine.search("Alice")).toHaveLength(1);
    expect(engine.search("Alice")[0].id).toBe(1);
  });
});

describe("TextSearchEngine — O1: trigram-only index", () => {
  type NameItem = { id: number; name: string };

  it("T4: 2-char query falls back to linear scan and returns correct results", () => {
    const items: NameItem[] = [
      { id: 1, name: "Kyiv" },
      { id: 2, name: "Dnipro" },
    ];
    const engine = new TextSearchEngine<NameItem>({
      data: items,
      fields: ["name"],
      minQueryLength: 1,
    });

    // 2-char query → shorter than trigram length → linear fallback
    expect(engine.search("name", "ky").map((i) => i.id)).toEqual([1]);
    expect(engine.search("ky").map((i) => i.id)).toEqual([1]);
  });

  it("T6: index contains only trigram keys — no 1-gram or 2-gram keys for strings of length ≥ 3", () => {
    const items: NameItem[] = [{ id: 1, name: "hello" }];
    const engine = new TextSearchEngine<NameItem>({
      data: items,
      fields: ["name"],
    });

    // Access internal index via type cast
    const ngramMap: Map<string, Set<number>> = (
      engine as any
    ).runtime.flatIndexes.get("name").ngramMap;

    // All keys must be exactly 3 characters (trigrams for "hello")
    for (const key of ngramMap.keys()) {
      expect(key).toHaveLength(3);
    }

    // Exact trigrams of "hello": hel, ell, llo
    expect(ngramMap.has("hel")).toBe(true);
    expect(ngramMap.has("ell")).toBe(true);
    expect(ngramMap.has("llo")).toBe(true);
    expect(ngramMap.size).toBe(3);

    // No 1-gram or 2-gram keys
    expect(ngramMap.has("h")).toBe(false);
    expect(ngramMap.has("he")).toBe(false);
    expect(ngramMap.has("lo")).toBe(false);
    expect(ngramMap.has("o")).toBe(false);
  });

  it("T8: clearIndexes() + search(field, query) falls back to linear correctly", () => {
    const items: NameItem[] = [
      { id: 1, name: "London" },
      { id: 2, name: "Berlin" },
    ];
    const engine = new TextSearchEngine<NameItem>({
      data: items,
      fields: ["name"],
    });
    engine.clearIndexes();

    expect(engine.search("name", "London").map((i) => i.id)).toEqual([1]);
    expect(engine.search("name", "Berlin").map((i) => i.id)).toEqual([2]);
    expect(engine.search("name", "Paris")).toEqual([]);
  });
});

describe("TextSearchEngine — O3: Uint8Array dedup in searchAllFields", () => {
  it("T5: item matching multiple indexed fields appears exactly once in results", () => {
    type StatusItem = { id: number; title: string; status: string };
    const items: StatusItem[] = [
      { id: 1, title: "pending review", status: "pending" },
      { id: 2, title: "done", status: "done" },
    ];
    const engine = new TextSearchEngine<StatusItem>({
      data: items,
      fields: ["title", "status"],
    });

    // "pending" matches both "title" and "status" of item 1
    const result = engine.search("pending");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("T2: filterByPreviousResult two-step matches direct indexed search results", () => {
    type Person = {
      id: number;
      name: string;
      city: string;
      tag: string;
      desc: string;
    };
    const data: Person[] = [
      { id: 1, name: "John", city: "New York", tag: "vip", desc: "manager" },
      {
        id: 2,
        name: "Johnny",
        city: "Boston",
        tag: "regular",
        desc: "engineer",
      },
      { id: 3, name: "Alice", city: "Chicago", tag: "vip", desc: "director" },
    ];

    const twoStepEngine = new TextSearchEngine<Person>({
      data,
      fields: ["name", "city", "tag", "desc"],
      filterByPreviousResult: true,
    });
    twoStepEngine.search("jo"); // prime previousResult
    const twoStep = twoStepEngine.search("joh");

    const directEngine = new TextSearchEngine<Person>({
      data,
      fields: ["name", "city", "tag", "desc"],
    });
    const direct = directEngine.search("joh");

    expect(twoStep.map((p) => p.id).sort()).toEqual(
      direct.map((p) => p.id).sort(),
    );
  });

  it("T3: resetSearchState() forces next search to scan full dataset", () => {
    type Person = { id: number; name: string };
    const data: Person[] = [
      { id: 1, name: "John" },
      { id: 2, name: "Johnny" },
      { id: 3, name: "Alice" },
    ];
    const engine = new TextSearchEngine<Person>({
      data,
      fields: ["name"],
      filterByPreviousResult: true,
    });

    engine.search("name", "jo"); // previousResult = [id:1, id:2]
    engine.resetSearchState();

    // After reset, "alice" must match from full dataset, not narrow from [id:1, id:2]
    const result = engine.search("name", "alice");
    expect(result.map((p) => p.id)).toEqual([3]);
  });

  it("T7: data() replacement clears previousResult; next search uses new full dataset", () => {
    type Person = { id: number; name: string };
    const data: Person[] = [
      { id: 1, name: "John" },
      { id: 2, name: "Johnny" },
    ];
    const engine = new TextSearchEngine<Person>({
      data,
      fields: ["name"],
      filterByPreviousResult: true,
    });

    engine.search("name", "jo"); // save previousResult

    const newData: Person[] = [
      { id: 10, name: "Alice" },
      { id: 11, name: "Bob" },
    ];
    engine.data(newData);

    // previousResult must have been cleared; searching should use newData
    const result = engine.search("name", "alice");
    expect(result.map((p) => p.id)).toEqual([10]);
  });
});
