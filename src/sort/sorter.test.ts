import { describe, expect, it } from "vitest";

import { SortEngineError } from "./errors";
import { SortEngine } from "./sorter";

type User = {
  id: number;
  name: string;
  city: string;
  age: number;
};

const users: User[] = [
  { id: 1, name: "Mila", city: "Kyiv", age: 30 },
  { id: 2, name: "Alex", city: "Lviv", age: 25 },
  { id: 3, name: "John", city: "Kyiv", age: 25 },
  { id: 4, name: "Bella", city: "Odesa", age: 35 },
];

describe("SortEngine", () => {
  it("returns input when descriptors or data is empty", () => {
    const engine = new SortEngine<User>();
    expect(engine.sort(users, [])).toBe(users);
    expect(engine.sort([], [{ field: "age", direction: "asc" }])).toEqual([]);
  });

  it("sorts numeric field asc/desc without mutating original", () => {
    const engine = new SortEngine<User>();
    const asc = engine.sort(users, [{ field: "age", direction: "asc" }]);
    const desc = engine.sort(users, [{ field: "age", direction: "desc" }]);

    expect(asc.map((u) => u.id)).toEqual([2, 3, 1, 4]);
    expect(desc.map((u) => u.id)).toEqual([4, 1, 3, 2]);
    expect(users.map((u) => u.id)).toEqual([1, 2, 3, 4]);
  });

  it("sorts by multiple fields with tie-breaking", () => {
    const engine = new SortEngine<User>();
    const result = engine.sort(users, [
      { field: "age", direction: "asc" },
      { field: "name", direction: "asc" },
    ]);
    expect(result.map((u) => u.id)).toEqual([2, 3, 1, 4]);
  });

  it("mutates input when inPlace is true", () => {
    const engine = new SortEngine<User>();
    const copy = [...users];
    const result = engine.sort(
      copy,
      [{ field: "name", direction: "asc" }],
      true,
    );
    expect(result).toBe(copy);
    expect(copy.map((u) => u.id)).toEqual([2, 4, 3, 1]);
  });

  it("sort(descriptors) uses stored dataset and throws without one", () => {
    const engine = new SortEngine<User>({ data: users, fields: ["age"] });
    expect(
      engine.sort([{ field: "age", direction: "asc" }]).map((u) => u.id),
    ).toEqual([2, 3, 1, 4]);

    const empty = new SortEngine<User>();
    expect(() => empty.sort([{ field: "age", direction: "asc" }])).toThrowError(
      SortEngineError,
    );
    expect(() => empty.sort([{ field: "age", direction: "asc" }])).toThrow(
      "no dataset in memory",
    );
  });

  it("data() replaces stored dataset without re-initializing engine", () => {
    const engine = new SortEngine<User>({ data: users, fields: ["age"] });

    const nextUsers: User[] = [
      { id: 10, name: "Tim", city: "New-York", age: 30 },
      { id: 11, name: "Mona", city: "Miami", age: 22 },
      { id: 12, name: "John", city: "Boston", age: 40 },
    ];

    engine.data(nextUsers);

    expect(
      engine.sort([{ field: "age", direction: "asc" }]).map((u) => u.id),
    ).toEqual([11, 10, 12]);
  });

  it("getOriginData returns stored dataset", () => {
    const engine = new SortEngine<User>({ data: users, fields: ["age"] });

    expect(engine.getOriginData()).toBe(users);

    const nextUsers: User[] = [
      { id: 20, name: "Lia", city: "Berlin", age: 28 },
    ];

    engine.data(nextUsers);
    expect(engine.getOriginData()).toBe(nextUsers);

    engine.clearData();
    expect(engine.getOriginData()).toEqual([]);
  });

  describe("buildIndex (cached fast path)", () => {
    it("sorts asc/desc via cached index", () => {
      const engine = new SortEngine<User>({ data: users, fields: ["age"] });

      expect(
        engine
          .sort(users, [{ field: "age", direction: "asc" }])
          .map((u) => u.id),
      ).toEqual([2, 3, 1, 4]);
      expect(
        engine
          .sort(users, [{ field: "age", direction: "desc" }])
          .map((u) => u.id),
      ).toEqual([4, 1, 3, 2]);
    });

    it("skips cache when data changes", () => {
      const engine = new SortEngine<User>({ data: users, fields: ["age"] });
      const other = [
        ...users,
        { id: 5, name: "Zara", city: "Dnipro", age: 20 },
      ];

      const result = engine.sort(other, [{ field: "age", direction: "asc" }]);
      expect(result.map((u) => u.id)).toEqual([5, 2, 3, 1, 4]);
    });

    it("clearIndexes frees cache (falls back to radix sort)", () => {
      const engine = new SortEngine<User>({ data: users, fields: ["age"] });
      engine.clearIndexes();

      const result = engine.sort(users, [{ field: "age", direction: "asc" }]);
      expect(result.map((u) => u.id)).toEqual([2, 3, 1, 4]);
    });

    it("supports chain usage", () => {
      const engine = new SortEngine<User>({
        data: users,
        fields: ["age", "name"],
      });

      const result = engine
        .sort([{ field: "age", direction: "asc" }])
        .sort([{ field: "name", direction: "asc" }]);

      expect(result.map((u) => u.id)).toEqual([2, 4, 3, 1]);
      expect(() => result.clearIndexes().clearData()).not.toThrow();
      expect(() => engine.sort([{ field: "age", direction: "asc" }])).toThrow(
        "no dataset in memory",
      );
    });

    it("constructor with data and fields auto-builds index", () => {
      const engine = new SortEngine<User>({ data: users, fields: ["age"] });
      expect(
        engine
          .sort(users, [{ field: "age", direction: "desc" }])
          .map((u) => u.id),
      ).toEqual([4, 1, 3, 2]);
    });
  });
});
