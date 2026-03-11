import { describe, expect, it } from "vitest";

import { FilterEngine } from "../filter/filter";
import { TextSearchEngine } from "../search/text-search";
import type { TextSearchEngineOptions } from "../search/types";
import { SortEngine } from "../sort/sorter";
import { MergeEnginesError } from "./errors";
import { MergeEngines } from "./merge-engines";

class CustomSearchEngine<
  T extends { id: number; name: string; city: string },
> extends TextSearchEngine<T> {}

class CountingSearchEngine<
  T extends { id: number; name: string; city: string },
> extends TextSearchEngine<T> {
  static constructionCount = 0;

  constructor(options: TextSearchEngineOptions<T> = {}) {
    super(options);
    CountingSearchEngine.constructionCount += 1;
  }
}

type User = {
  id: number;
  name: string;
  city: string;
  age: number;
};

const users: User[] = [
  { id: 1, name: "Alice", city: "Kyiv", age: 25 },
  { id: 2, name: "Bob", city: "Lviv", age: 30 },
  { id: 3, name: "Cara", city: "Kyiv", age: 30 },
  { id: 4, name: "Dany", city: "Odesa", age: 25 },
  { id: 5, name: "Evan", city: "Lviv", age: 35 },
];

const engine = new MergeEngines<User>({
  imports: [TextSearchEngine, SortEngine, FilterEngine],
  data: users,
  search: { fields: ["name", "city"], minQueryLength: 1 },
  sort: { fields: ["age", "name"] },
  filter: { fields: ["city", "age"] },
});

describe("MergeEngines", () => {
  it("search() works across all fields and by specific field", () => {
    expect(engine.search("Alice")).toHaveLength(1);
    expect(engine.search("city", "Kyiv").map((u) => u.id)).toEqual(
      expect.arrayContaining([1, 3]),
    );
    expect(engine.search("name", "Zzz")).toEqual([]);
  });

  it("sort() works with stored dataset and explicit dataset", () => {
    expect(
      engine.sort([{ field: "age", direction: "asc" }]).map((u) => u.id),
    ).toEqual([1, 4, 2, 3, 5]);
    expect(
      engine
        .sort([users[4], users[0]], [{ field: "name", direction: "asc" }])
        .map((u) => u.id),
    ).toEqual([1, 5]);
  });

  it("filter() works with stored dataset and explicit dataset", () => {
    expect(engine.filter([{ field: "city", values: ["Kyiv"] }])).toHaveLength(
      2,
    );
    expect(
      engine.filter(users, [{ field: "age", values: [30, 35] }]),
    ).toHaveLength(3);
  });

  it("filter() supports exclude criteria through the merge facade", () => {
    expect(
      engine.filter([{ field: "id", exclude: [1, 3] }]).map((user) => user.id),
    ).toEqual([2, 4, 5]);
  });

  it("filter() supports mutable exclude through the merge facade", () => {
    const dataset = users.map((user) => ({ ...user }));
    const merge = new MergeEngines<User>({
      imports: [FilterEngine],
      data: dataset,
      filter: {
        fields: ["id", "city"],
        mutableExcludeField: "id",
      },
    });

    const result = merge.filter([{ field: "id", exclude: [1, 4] }]);

    expect(
      result.map((user) => user.id).sort((leftId, rightId) => leftId - rightId),
    ).toEqual([2, 3, 5]);
    expect(
      merge
        .getOriginData()
        .map((user) => user.id)
        .sort((leftId, rightId) => leftId - rightId),
    ).toEqual([2, 3, 5]);
    expect(
      merge
        .filter([{ field: "city", values: ["Lviv"] }])
        .map((user) => user.id),
    ).toEqual([2, 5]);
  });

  it("throws when calling a method whose engine was not imported", () => {
    const searchOnly = new MergeEngines<User>({
      imports: [TextSearchEngine],
      data: users,
      search: { fields: ["name"] },
    });

    expect(() =>
      searchOnly.sort([{ field: "age", direction: "asc" }]),
    ).toThrowError(MergeEnginesError);
    expect(() => searchOnly.sort([{ field: "age", direction: "asc" }])).toThrow(
      "SortEngine is not available",
    );
    expect(() =>
      searchOnly.filter([{ field: "city", values: ["Kyiv"] }]),
    ).toThrow("FilterEngine is not available");
    expect(() =>
      new MergeEngines<User>({ imports: [SortEngine], data: users }).search(
        "x",
      ),
    ).toThrow("TextSearchEngine is not available");
  });

  it("does not throw when optional config sections are omitted", () => {
    expect(
      () =>
        new MergeEngines<User>({
          imports: [TextSearchEngine, SortEngine, FilterEngine],
          data: users,
        }),
    ).not.toThrow();
  });

  it("works with engines exposed only through the abstract merge provider", () => {
    const merge = new MergeEngines<User>({
      imports: [CustomSearchEngine],
      data: users,
      search: { fields: ["name", "city"], minQueryLength: 1 },
    });

    expect(merge.search("Kyiv").map((user) => user.id)).toEqual([1, 3]);
  });

  it("instantiates each imported engine only once during setup", () => {
    CountingSearchEngine.constructionCount = 0;

    const merge = new MergeEngines<User>({
      imports: [CountingSearchEngine],
      data: users,
      search: { fields: ["name", "city"], minQueryLength: 1 },
    });

    expect(CountingSearchEngine.constructionCount).toBe(1);
    expect(merge.search("Kyiv").map((user) => user.id)).toEqual([1, 3]);
  });

  it("clearIndexes() clears indexes for selected module", () => {
    const merge = new MergeEngines<User>({
      imports: [TextSearchEngine, SortEngine, FilterEngine],
      data: users,
      search: { fields: ["name", "city"], minQueryLength: 1 },
      sort: { fields: ["age", "name"] },
      filter: { fields: ["city", "age"] },
    });

    expect(merge.search("Alice")).toHaveLength(1);
    merge.clearIndexes("search");
    expect(merge.search("Alice")).toHaveLength(1);

    expect(() => merge.clearIndexes("sort")).not.toThrow();
    expect(
      merge.sort([{ field: "age", direction: "asc" }]).map((u) => u.id),
    ).toEqual([1, 4, 2, 3, 5]);

    expect(() => merge.clearIndexes("filter")).not.toThrow();
    expect(merge.filter([{ field: "city", values: ["Kyiv"] }])).toHaveLength(2);
  });

  it("clearIndexes() throws when selected module was not imported", () => {
    const searchOnly = new MergeEngines<User>({
      imports: [TextSearchEngine],
      data: users,
      search: { fields: ["name"] },
    });

    expect(() => searchOnly.clearIndexes("sort")).toThrow(
      "SortEngine is not available",
    );
    expect(() => searchOnly.clearIndexes("filter")).toThrow(
      "FilterEngine is not available",
    );
  });

  it("supports chaining across public methods without leaking filter chain methods", () => {
    const merge = new MergeEngines<User>({
      imports: [TextSearchEngine, SortEngine, FilterEngine],
      data: users,
      search: { fields: ["name", "city"], minQueryLength: 1 },
      sort: { fields: ["age", "name"] },
      filter: { fields: ["city", "age"] },
    });

    const result = merge
      .search("i")
      .sort([{ field: "age", direction: "asc" }])
      .filter([{ field: "city", values: ["Kyiv"] }]);

    expect(result.map((item) => item.id)).toEqual([1, 3]);
    expect("resetFilterState" in result).toBe(false);
    expect(() =>
      result.clearIndexes("search").clearIndexes("sort").clearIndexes("filter"),
    ).not.toThrow();
  });

  it("keeps filterByPreviousResult semantics across repeated merge pipeline runs", () => {
    const merge = new MergeEngines<User>({
      imports: [TextSearchEngine, SortEngine, FilterEngine],
      data: [
        { id: 10, name: "Lucas 33229", city: "Miami", age: 22 },
        { id: 11, name: "Mia 33219", city: "Miami", age: 22 },
        { id: 12, name: "Noah 33209", city: "Miami", age: 22 },
        { id: 13, name: "Lina 33299", city: "Miami", age: 26 },
        { id: 14, name: "Owen 33277", city: "Boston", age: 26 },
      ],
      search: { fields: ["name", "city"], minQueryLength: 1 },
      sort: { fields: ["age", "name", "city"] },
      filter: {
        fields: ["city", "age"],
        filterByPreviousResult: true,
      },
    });

    const first = merge
      .search("332")
      .filter([
        { field: "city", values: ["Miami"] },
        { field: "age", values: [22] },
      ])
      .sort([{ field: "age", direction: "asc" }]);

    const second = merge
      .search("332")
      .filter([
        { field: "city", values: ["Miami"] },
        { field: "age", values: [22, 26] },
      ])
      .sort([{ field: "age", direction: "asc" }]);

    expect(first.map((user) => user.id)).toEqual([10, 11, 12]);
    expect(second).toEqual([]);
  });

  it("clearData() clears data for selected module", () => {
    const merge = new MergeEngines<User>({
      imports: [TextSearchEngine, SortEngine, FilterEngine],
      data: users,
      search: { fields: ["name", "city"], minQueryLength: 1 },
      sort: { fields: ["age", "name"] },
      filter: { fields: ["city", "age"] },
    });

    merge.clearData("search");
    expect(merge.search("Alice")).toEqual([]);

    merge.clearData("sort");
    expect(() => merge.sort([{ field: "age", direction: "asc" }])).toThrow(
      "no dataset in memory",
    );

    merge.clearData("filter");
    expect(() => merge.filter([{ field: "city", values: ["Kyiv"] }])).toThrow(
      "no dataset in memory",
    );
  });

  it("clearData() throws when selected module was not imported", () => {
    const searchOnly = new MergeEngines<User>({
      imports: [TextSearchEngine],
      data: users,
      search: { fields: ["name"] },
    });

    expect(() => searchOnly.clearData("sort")).toThrow(
      "SortEngine is not available",
    );
    expect(() => searchOnly.clearData("filter")).toThrow(
      "FilterEngine is not available",
    );
  });

  it("data() replaces dataset for all imported modules", () => {
    const merge = new MergeEngines<User>({
      imports: [TextSearchEngine, SortEngine, FilterEngine],
      data: users,
      search: { fields: ["name", "city"], minQueryLength: 1 },
      sort: { fields: ["age", "name"] },
      filter: { fields: ["city", "age"] },
    });

    const nextUsers: User[] = [
      { id: 10, name: "Tim", city: "New-York", age: 30 },
      { id: 11, name: "Mona", city: "Miami", age: 22 },
      { id: 12, name: "Zed", city: "Boston", age: 40 },
    ];

    merge.data(nextUsers);

    expect(merge.search("Tim").map((user) => user.id)).toEqual([10]);
    expect(
      merge.sort([{ field: "age", direction: "asc" }]).map((user) => user.id),
    ).toEqual([11, 10, 12]);
    expect(
      merge
        .filter([{ field: "city", values: ["Miami"] }])
        .map((user) => user.id),
    ).toEqual([11]);
  });

  it("add() appends a batch once and updates all imported modules", () => {
    const dataset = users.map((user) => ({ ...user }));
    const merge = new MergeEngines<User>({
      imports: [TextSearchEngine, SortEngine, FilterEngine],
      data: dataset,
      search: { fields: ["name", "city"], minQueryLength: 1 },
      sort: { fields: ["age", "name"] },
      filter: { fields: ["city", "age"], filterByPreviousResult: true },
    });

    merge.search("Alice");
    merge.sort([{ field: "age", direction: "asc" }]);
    merge.filter([{ field: "city", values: ["Kyiv"] }]);
    merge.add([
      { id: 10, name: "Tim", city: "Boston", age: 20 },
      { id: 11, name: "Mila", city: "Kyiv", age: 40 },
    ]);

    expect(merge.getOriginData().map((user) => user.id)).toEqual([
      1, 2, 3, 4, 5, 10, 11,
    ]);
    expect(merge.search("Tim").map((user) => user.id)).toEqual([10]);
    expect(
      merge
        .filter([{ field: "city", values: ["Kyiv"] }])
        .map((user) => user.id),
    ).toEqual([1, 3, 11]);
    expect(
      merge.sort([{ field: "age", direction: "asc" }]).map((user) => user.id),
    ).toEqual([10, 1, 4, 2, 3, 5, 11]);
  });

  it("getOriginData() returns shared origin dataset", () => {
    const merge = new MergeEngines<User>({
      imports: [TextSearchEngine, SortEngine, FilterEngine],
      data: users,
      search: { fields: ["name", "city"], minQueryLength: 1 },
      sort: { fields: ["age", "name"] },
      filter: { fields: ["city", "age"] },
    });

    expect(merge.getOriginData()).toBe(users);

    const nextUsers: User[] = [
      { id: 10, name: "Tim", city: "New-York", age: 30 },
      { id: 11, name: "Mona", city: "Miami", age: 22 },
    ];

    merge.data(nextUsers);

    expect(merge.getOriginData()).toBe(nextUsers);
  });

  it("getOriginData() works when only one module is imported", () => {
    const searchOnly = new MergeEngines<User>({
      imports: [TextSearchEngine],
      data: users,
      search: { fields: ["name"] },
    });

    expect(searchOnly.getOriginData()).toBe(users);
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

describe("MergeEngines — nestedFields", () => {
  it("mutable exclude keeps nested filter indexes in sync through merge facade", () => {
    const dataset: UserWithOrders[] = usersWithOrders.map((user) => ({
      ...user,
      orders: user.orders.map((order) => ({ ...order })),
    }));
    const merge = new MergeEngines<UserWithOrders>({
      imports: [FilterEngine],
      data: dataset,
      filter: {
        nestedFields: ["orders.status"],
        mutableExcludeField: "id",
      },
    });

    merge.filter([{ field: "id", exclude: ["1"] }]);

    expect(
      merge
        .filter([{ field: "orders.status", values: ["pending"] }])
        .map((user) => user.id),
    ).toEqual(["2"]);
  });

  it("search with nestedFields finds by nested values", () => {
    const merge = new MergeEngines<UserWithOrders>({
      imports: [TextSearchEngine, FilterEngine],
      data: usersWithOrders,
      search: {
        fields: ["name", "city"],
        nestedFields: ["orders.status"],
        minQueryLength: 2,
      },
      filter: {
        fields: ["city"],
        nestedFields: ["orders.status"],
      },
    });

    const searchResult = merge.search("delivered");
    expect(searchResult.map((u) => u.id)).toEqual(["1"]);
  });

  it("filter with nestedFields filters by nested values", () => {
    const merge = new MergeEngines<UserWithOrders>({
      imports: [TextSearchEngine, FilterEngine],
      data: usersWithOrders,
      search: {
        fields: ["name"],
        nestedFields: ["orders.status"],
      },
      filter: {
        fields: ["city"],
        nestedFields: ["orders.status"],
      },
    });

    const filterResult = merge.filter([
      { field: "orders.status", values: ["pending"] },
    ]);
    expect(filterResult.map((u) => u.id)).toEqual(["1", "2"]);
  });

  it("chains search and filter with nestedFields", () => {
    const merge = new MergeEngines<UserWithOrders>({
      imports: [TextSearchEngine, SortEngine, FilterEngine],
      data: usersWithOrders,
      search: {
        fields: ["name", "city"],
        nestedFields: ["orders.status"],
      },
      filter: {
        fields: ["city"],
        nestedFields: ["orders.status"],
      },
      sort: { fields: ["age"] },
    });

    const result = merge
      .search("pending")
      .filter([{ field: "city", values: ["LA"] }]);
    expect(result.map((u) => u.id)).toEqual(["2"]);
  });

  it("data() rebuilds nested indexes across all modules", () => {
    const merge = new MergeEngines<UserWithOrders>({
      imports: [TextSearchEngine, FilterEngine],
      data: usersWithOrders,
      search: {
        fields: ["name"],
        nestedFields: ["orders.status"],
      },
      filter: {
        nestedFields: ["orders.status"],
      },
    });

    const newUsers: UserWithOrders[] = [
      {
        id: "10",
        name: "Lia",
        city: "Berlin",
        age: 28,
        orders: [{ id: "10", status: "shipped" }],
      },
    ];

    merge.data(newUsers);

    expect(merge.search("orders.status", "shipped").map((u) => u.id)).toEqual([
      "10",
    ]);
    expect(
      merge
        .filter([{ field: "orders.status", values: ["shipped"] }])
        .map((u) => u.id),
    ).toEqual(["10"]);
    expect(merge.search("orders.status", "pending")).toEqual([]);
  });
});
