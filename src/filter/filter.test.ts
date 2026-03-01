import { beforeEach, describe, expect, it } from "vitest";

import { FilterEngine } from "./filter";

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
