import { beforeEach, describe, expect, it } from "vitest";

import { FilterEngineError } from "./errors";
import { FilterEngine } from "./filter";
import { FILTER_ENGINE_EXECUTE } from "./internal";

type User = {
  id: number;
  name: string;
  city: string;
  age: number;
  active: boolean;
};

const users: User[] = [
  { id: 1, name: "Alice", city: "Kyiv", age: 25, active: true },
  { id: 2, name: "Bob", city: "Lviv", age: 30, active: false },
  { id: 3, name: "Cara", city: "Kyiv", age: 30, active: true },
  { id: 4, name: "Dany", city: "Odesa", age: 25, active: false },
  { id: 5, name: "Evan", city: "Lviv", age: 35, active: true },
];

describe("FilterEngine", () => {
  it("returns input data when criteria is empty", () => {
    const engine = new FilterEngine<User>();
    expect(engine.filter(users, [])).toBe(users);
  });

  it("filters via indexed criteria (AND logic)", () => {
    const engine = new FilterEngine<User>({
      data: users,
      fields: ["city", "age"],
    });

    const result = engine.filter(users, [
      { field: "city", values: ["Kyiv", "Lviv"] },
      { field: "age", values: [30] },
    ]);

    expect(result.map((u) => u.id)).toEqual([2, 3]);
  });

  it("mixed path: indexed pre-filter + linear criteria", () => {
    const engine = new FilterEngine<User>({ data: users, fields: ["city"] });

    const result = engine.filter(users, [
      { field: "city", values: ["Kyiv", "Lviv"] },
      { field: "active", values: [true] },
    ]);

    expect(result.map((u) => u.id)).toEqual([1, 3, 5]);
  });

  it("pure linear filtering when no indexes exist", () => {
    const engine = new FilterEngine<User>();

    const result = engine.filter(users, [
      { field: "city", values: ["Kyiv", "Odesa"] },
      { field: "age", values: [25] },
    ]);

    expect(result.map((u) => u.id)).toEqual([1, 4]);
  });

  it("filter(criteria) uses stored dataset and throws without one", () => {
    const engine = new FilterEngine<User>({ data: users, fields: ["city"] });
    expect(
      engine.filter([{ field: "city", values: ["Odesa"] }]).map((u) => u.id),
    ).toEqual([4]);

    const empty = new FilterEngine<User>();
    expect(() =>
      empty.filter([{ field: "city", values: ["Kyiv"] }]),
    ).toThrowError(FilterEngineError);
    expect(() => empty.filter([{ field: "city", values: ["Kyiv"] }])).toThrow(
      "no dataset in memory",
    );
  });

  it("constructor with data and fields auto-builds index", () => {
    const engine = new FilterEngine<User>({ data: users, fields: ["city"] });
    expect(
      engine
        .filter(users, [{ field: "city", values: ["Lviv"] }])
        .map((u) => u.id),
    ).toEqual([2, 5]);
  });

  it("data() replaces stored dataset without re-initializing engine", () => {
    const engine = new FilterEngine<User>({
      data: users,
      fields: ["city", "age"],
      filterByPreviousResult: true,
    });

    engine.filter([{ field: "city", values: ["Kyiv"] }]);

    const nextUsers: User[] = [
      { id: 10, name: "Tim", city: "New-York", age: 30, active: true },
      { id: 11, name: "Mona", city: "Miami", age: 22, active: false },
    ];

    engine.data(nextUsers);

    expect(
      engine.filter([{ field: "city", values: ["New-York"] }]).map((u) => u.id),
    ).toEqual([10]);
    expect(engine.filter([{ field: "city", values: ["Kyiv"] }])).toEqual([]);
  });

  it("getOriginData returns stored dataset", () => {
    const engine = new FilterEngine<User>({
      data: users,
      fields: ["city", "age"],
    });

    expect(engine.getOriginData()).toBe(users);

    const nextUsers: User[] = [
      { id: 20, name: "Lia", city: "Berlin", age: 28, active: true },
    ];

    engine.data(nextUsers);
    expect(engine.getOriginData()).toBe(nextUsers);

    engine.clearData();
    expect(engine.getOriginData()).toEqual([]);
  });

  it("internal raw execution returns plain arrays for merge integration", () => {
    const engine = new FilterEngine<User>({
      data: users,
      fields: ["city"],
      filterByPreviousResult: true,
    });

    const firstResult = engine[FILTER_ENGINE_EXECUTE]([
      { field: "city", values: ["Kyiv", "Lviv"] },
    ]);
    const secondResult = engine[FILTER_ENGINE_EXECUTE]([
      { field: "city", values: ["Kyiv", "Lviv"] },
      { field: "age", values: [30] },
    ]);

    expect(
      firstResult.map((u) => u.id).sort((leftId, rightId) => leftId - rightId),
    ).toEqual([1, 2, 3, 5]);
    expect(
      secondResult.map((u) => u.id).sort((leftId, rightId) => leftId - rightId),
    ).toEqual([2, 3]);
    expect("clearIndexes" in firstResult).toBe(false);
  });

  describe("filterByPreviousResult (sequential mode)", () => {
    let engine: FilterEngine<User>;

    beforeEach(() => {
      engine = new FilterEngine<User>({
        data: users,
        fields: ["city"],
        filterByPreviousResult: true,
      });
    });

    it("returns cached result when criteria have not changed", () => {
      const first = engine.filter([{ field: "city", values: ["Kyiv"] }]);
      const second = engine.filter([{ field: "city", values: ["Kyiv"] }]);
      expect(second).toBe(first);
    });

    it("narrows result when criteria are added", () => {
      engine.filter([{ field: "city", values: ["Kyiv", "Lviv"] }]);
      const result = engine.filter([
        { field: "city", values: ["Kyiv", "Lviv"] },
        { field: "age", values: [30] },
      ]);
      expect(result).toHaveLength(2);
    });

    it("does not corrupt indexed buckets after sequential single-field filters", () => {
      engine.filter([{ field: "city", values: ["Kyiv"] }]);
      engine.filter([
        { field: "city", values: ["Kyiv"] },
        { field: "age", values: [25] },
      ]);
      engine.filter([{ field: "age", values: [25] }]);

      const result = engine.filter([
        { field: "age", values: [25] },
        { field: "city", values: ["Kyiv"] },
      ]);

      expect(result.map((user) => user.id)).toEqual([1]);
    });

    it("recalculates from full dataset when a criterion is removed", () => {
      engine.filter([
        { field: "city", values: ["Kyiv"] },
        { field: "age", values: [25] },
      ]);
      const result = engine.filter([{ field: "city", values: ["Kyiv"] }]);
      expect(result).toHaveLength(2);
    });

    it("resetFilterState clears sequential cache", () => {
      engine.filter([{ field: "city", values: ["Kyiv"] }]);
      engine.resetFilterState();
      const result = engine.filter([{ field: "city", values: ["Lviv"] }]);
      expect(result.map((u) => u.id)).toEqual(expect.arrayContaining([2, 5]));
    });

    it("supports chain usage for public methods", () => {
      const result = engine
        .filter([{ field: "city", values: ["Kyiv", "Lviv"] }])
        .filter([{ field: "age", values: [30] }]);

      expect(result.map((u) => u.id)).toEqual(expect.arrayContaining([2, 3]));
      expect(() =>
        result.clearIndexes().resetFilterState().clearData(),
      ).not.toThrow();
      expect(() =>
        engine.filter([{ field: "city", values: ["Kyiv"] }]),
      ).toThrow("no dataset in memory");
    });
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

describe("FilterEngine — nestedFields", () => {
  it("filters by nested field using indexed path", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    const result = engine.filter([
      { field: "orders.status", values: ["pending"] },
    ]);
    expect(result.map((u) => u.id)).toEqual(["1", "2"]);
  });

  it("filters by nested field with multiple values", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    const result = engine.filter([
      { field: "orders.status", values: ["pending", "delivered"] },
    ]);
    expect(result.map((u) => u.id)).toEqual(["1", "2"]);
  });

  it("filters by nested field matching single value", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    const result = engine.filter([
      { field: "orders.status", values: ["delivered"] },
    ]);
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  it("combines nested and flat field criteria", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      fields: ["city"],
      nestedFields: ["orders.status"],
    });

    const result = engine.filter([
      { field: "orders.status", values: ["pending"] },
      { field: "city", values: ["LA"] },
    ]);
    expect(result.map((u) => u.id)).toEqual(["2"]);
  });

  it("intersects multiple nested indexed criteria", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status", "orders.id"],
    });

    const result = engine.filter([
      { field: "orders.status", values: ["pending"] },
      { field: "orders.id", values: ["3"] },
    ]);

    expect(result.map((u) => u.id)).toEqual(["2"]);
  });

  it("returns empty when no nested match", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    const result = engine.filter([
      { field: "orders.status", values: ["cancelled"] },
    ]);
    expect(result).toEqual([]);
  });

  it("clearIndexes clears nested indexes; linear fallback works", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    engine.clearIndexes();

    const result = engine.filter([
      { field: "orders.status", values: ["delivered"] },
    ]);
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  it("clearData clears nested indexes too", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
    });

    engine.clearData();
    expect(() =>
      engine.filter([{ field: "orders.status", values: ["pending"] }]),
    ).toThrow("no dataset in memory");
  });

  it("data() rebuilds nested indexes for new dataset", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      nestedFields: ["orders.status"],
      filterByPreviousResult: true,
    });

    expect(
      engine
        .filter([{ field: "orders.status", values: ["pending"] }])
        .map((u) => u.id),
    ).toEqual(["1", "2"]);

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

    expect(
      engine.filter([{ field: "orders.status", values: ["pending"] }]),
    ).toEqual([]);
    expect(
      engine
        .filter([{ field: "orders.status", values: ["shipped"] }])
        .map((u) => u.id),
    ).toEqual(["10"]);
  });

  it("resetFilterState works with nested criteria", () => {
    const engine = new FilterEngine<UserWithOrders>({
      data: usersWithOrders,
      fields: ["city"],
      nestedFields: ["orders.status"],
      filterByPreviousResult: true,
    });

    engine.filter([{ field: "orders.status", values: ["pending"] }]);
    engine.resetFilterState();

    const result = engine.filter([
      { field: "orders.status", values: ["delivered"] },
    ]);
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  describe("filterByPreviousResult with nested criteria", () => {
    let engine: FilterEngine<UserWithOrders>;

    beforeEach(() => {
      engine = new FilterEngine<UserWithOrders>({
        data: usersWithOrders,
        fields: ["city"],
        nestedFields: ["orders.status"],
        filterByPreviousResult: true,
      });
    });

    it("narrows result when flat criterion is added to nested", () => {
      engine.filter([{ field: "orders.status", values: ["pending"] }]);
      const result = engine.filter([
        { field: "orders.status", values: ["pending"] },
        { field: "city", values: ["LA"] },
      ]);
      expect(result.map((u) => u.id)).toEqual(["2"]);
    });

    it("returns cached result when nested criteria unchanged", () => {
      const first = engine.filter([
        { field: "orders.status", values: ["pending"] },
      ]);
      const second = engine.filter([
        { field: "orders.status", values: ["pending"] },
      ]);
      expect(second).toBe(first);
    });

    it("recalculates from full dataset when nested criterion is removed", () => {
      engine.filter([
        { field: "orders.status", values: ["pending"] },
        { field: "city", values: ["New-York"] },
      ]);
      const result = engine.filter([
        { field: "orders.status", values: ["pending"] },
      ]);
      expect(result.map((u) => u.id)).toEqual(["1", "2"]);
    });

    it("reuses nested indexes when filtering a subset of the stored dataset", () => {
      const subset = usersWithOrders.slice(0, 2);

      const result = engine.filter(subset, [
        { field: "orders.status", values: ["pending"] },
        { field: "city", values: ["New-York"] },
      ]);

      expect(result.map((u) => u.id)).toEqual(["1"]);
    });
  });
});
