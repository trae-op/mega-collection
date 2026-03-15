import { describe, expect, it, vi } from "vitest";

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

  it("add() updates cached single-field sorting incrementally without rebuild", () => {
    const dataset = users.map((user) => ({ ...user }));
    const engine = new SortEngine<User>({ data: dataset, fields: ["age"] });
    const buildIndexSpy = vi.spyOn(
      engine as never,
      "buildIndexForDataset" as never,
    );

    engine.add([{ id: 5, name: "Zara", city: "Dnipro", age: 20 }]);

    expect(
      engine.sort([{ field: "age", direction: "asc" }]).map((user) => user.id),
    ).toEqual([5, 2, 3, 1, 4]);
    expect(buildIndexSpy).not.toHaveBeenCalled();
  });

  it("internal add path updates cached sorting for shared State", async () => {
    const State = (await import("../State")).State;
    const dataset = users.map((user) => ({ ...user }));
    const state = new State<User>(dataset);
    const engine = new SortEngine<User>({
      state,
      fields: ["age"],
    });
    const buildIndexSpy = vi.spyOn(
      engine as never,
      "buildIndexForDataset" as never,
    );

    state.add([{ id: 5, name: "Zara", city: "Dnipro", age: 20 }]);

    expect(
      engine.sort([{ field: "age", direction: "asc" }]).map((user) => user.id),
    ).toEqual([5, 2, 3, 1, 4]);
    expect(buildIndexSpy).not.toHaveBeenCalled();
  });

  it("add() treats an empty batch as a no-op", () => {
    const engine = new SortEngine<User>({ data: users, fields: ["age"] });

    engine.add([]);

    expect(engine.getOriginData()).toBe(users);
    expect(
      engine.sort([{ field: "age", direction: "asc" }]).map((user) => user.id),
    ).toEqual([2, 3, 1, 4]);
  });

  it("update() repositions cached sorting incrementally without full rebuild", () => {
    const dataset = users.map((user) => ({ ...user }));
    const engine = new SortEngine<User>({ data: dataset, fields: ["age"] });
    const buildIndexSpy = vi.spyOn(
      engine as never,
      "buildIndexForDataset" as never,
    );

    engine.update({
      field: "id",
      data: { id: 1, name: "Alice", city: "Kyiv", age: 18 },
    });

    expect(engine.getOriginData()).toBe(dataset);
    expect(
      engine.sort([{ field: "age", direction: "asc" }]).map((user) => user.id),
    ).toEqual([1, 2, 3, 4]);
    expect(buildIndexSpy).not.toHaveBeenCalled();
  });

  it("add() keeps sorting correct after indexes were cleared", () => {
    const dataset = users.map((user) => ({ ...user }));
    const engine = new SortEngine<User>({ data: dataset, fields: ["age"] });

    engine.clearIndexes();
    engine.add([{ id: 5, name: "Zara", city: "Dnipro", age: 20 }]);

    expect(
      engine.sort([{ field: "age", direction: "asc" }]).map((user) => user.id),
    ).toEqual([5, 2, 3, 1, 4]);
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

    it("sort(data, descriptors) recalculates against live values", () => {
      const mutableUsers = users.map((user) => ({ ...user }));
      const engine = new SortEngine<User>({
        data: mutableUsers,
        fields: ["age"],
      });

      mutableUsers[0].age = 10;

      const result = engine.sort(mutableUsers, [
        { field: "age", direction: "asc" },
      ]);
      expect(result.map((user) => user.id)).toEqual([1, 2, 3, 4]);
    });

    it("clearIndexes frees cache (falls back to radix sort)", () => {
      const engine = new SortEngine<User>({ data: users, fields: ["age"] });
      engine.clearIndexes();

      const result = engine.sort(users, [{ field: "age", direction: "asc" }]);
      expect(result.map((u) => u.id)).toEqual([2, 3, 1, 4]);
    });

    it("returns a plain array result", () => {
      const engine = new SortEngine<User>({
        data: users,
        fields: ["age", "name"],
      });

      const result = engine.sort([{ field: "age", direction: "asc" }]);

      expect(result.map((u) => u.id)).toEqual([2, 3, 1, 4]);
      expect("clearIndexes" in result).toBe(false);
      expect("data" in result).toBe(false);

      engine.clearIndexes().clearData();
      expect(() => engine.sort([{ field: "age", direction: "asc" }])).toThrow(
        "no dataset in memory",
      );
    });

    it("constructor eagerly builds index; sort() reuses it without rebuild", () => {
      const engine = new SortEngine<User>({ data: users, fields: ["age"] });
      const buildIndexSpy = vi.spyOn(
        engine as never,
        "buildIndexForDataset" as never,
      );

      expect(
        engine
          .sort(users, [{ field: "age", direction: "desc" }])
          .map((u) => u.id),
      ).toEqual([4, 1, 3, 2]);
      expect(
        engine.sort([{ field: "age", direction: "asc" }]).map((u) => u.id),
      ).toEqual([2, 3, 1, 4]);
      expect(buildIndexSpy).not.toHaveBeenCalled();
    });
  });

  describe("version-based cache", () => {
    it("engine.data([]) with configured fields does not throw", () => {
      const engine = new SortEngine<User>({ data: users, fields: ["age"] });

      expect(() => engine.data([])).not.toThrow();
      expect(engine.getOriginData()).toEqual([]);
    });

    it("engine.data(newData) eagerly rebuilds index for each configured field", () => {
      const engine = new SortEngine<User>({
        data: users,
        fields: ["age", "name"],
      });
      const buildIndexSpy = vi.spyOn(
        engine as never,
        "buildIndexForDataset" as never,
      );

      const nextUsers: User[] = [
        { id: 10, name: "Tim", city: "NYC", age: 30 },
        { id: 11, name: "Mona", city: "Miami", age: 22 },
      ];

      engine.data(nextUsers);

      expect(buildIndexSpy).toHaveBeenCalledTimes(2);
    });

    it("clearIndexes() → sort(descriptors) lazily rebuilds index once", () => {
      const engine = new SortEngine<User>({
        data: users,
        fields: ["age"],
      });
      const buildIndexSpy = vi.spyOn(
        engine as never,
        "buildIndexForDataset" as never,
      );

      engine.clearIndexes();

      const result1 = engine.sort([{ field: "age", direction: "asc" }]);
      expect(result1.map((u) => u.id)).toEqual([2, 3, 1, 4]);
      expect(buildIndexSpy).toHaveBeenCalledTimes(1);

      buildIndexSpy.mockClear();
      const result2 = engine.sort([{ field: "age", direction: "desc" }]);
      expect(result2.map((u) => u.id)).toEqual([4, 1, 3, 2]);
      expect(buildIndexSpy).not.toHaveBeenCalled();
    });

    it("sequential sort() calls reuse cache (buildIndexForDataset called zero times)", () => {
      const engine = new SortEngine<User>({
        data: users,
        fields: ["age"],
      });
      const buildIndexSpy = vi.spyOn(
        engine as never,
        "buildIndexForDataset" as never,
      );

      engine.sort([{ field: "age", direction: "asc" }]);
      engine.sort([{ field: "age", direction: "desc" }]);
      engine.sort([{ field: "age", direction: "asc" }]);

      expect(buildIndexSpy).not.toHaveBeenCalled();
    });

    it("remove via shared State clears cache; next sort rebuilds correctly", async () => {
      const { State } = await import("../State");
      const data: User[] = [
        { id: 1, name: "Mila", city: "Kyiv", age: 30 },
        { id: 2, name: "Alex", city: "Lviv", age: 25 },
        { id: 3, name: "John", city: "Kyiv", age: 25 },
        { id: 4, name: "Bella", city: "Odesa", age: 35 },
      ];
      const state = new State<User>(data);
      const engine = new SortEngine<User>({ state, fields: ["age"] });

      state.removeByFieldValue("id", 1);

      const result = engine.sort([{ field: "age", direction: "asc" }]);
      const ids = result.map((u) => u.id);
      expect(ids).toHaveLength(3);
      expect(ids).toContain(2);
      expect(ids).toContain(3);
      expect(ids).toContain(4);
    });

    it("update() on large dataset produces correct result via Uint32Array path", () => {
      const size = 1000;
      const largeData: User[] = Array.from({ length: size }, (_, i) => ({
        id: i + 1,
        name: `User${i}`,
        city: "City",
        age: i * 2,
      }));

      const engine = new SortEngine<User>({
        data: largeData,
        fields: ["age"],
      });

      engine.update({
        field: "id",
        data: { id: 500, name: "User499", city: "City", age: -1 },
      });

      const result = engine.sort([{ field: "age", direction: "asc" }]);
      expect(result[0].id).toBe(500);
      expect(result[0].age).toBe(-1);
      expect(result[1].age).toBe(0);
    });

    it("sorts correctly when first item has null in a numeric field", () => {
      type Item = { id: number; value: number | null };

      const data: Item[] = [
        { id: 1, value: null },
        { id: 2, value: 30 },
        { id: 3, value: 10 },
        { id: 4, value: 20 },
      ];

      const engine = new SortEngine<Item>({
        data,
        fields: ["value"],
      });

      // null coerces to 0 in Float64Array — probe skips null, detects numeric
      const result = engine.sort([{ field: "value", direction: "asc" }]);
      expect(result.map((i) => i.id)).toEqual([1, 3, 4, 2]);
    });

    it("multi-field sort uses version-based cache for primary field", () => {
      const engine = new SortEngine<User>({
        data: users,
        fields: ["age"],
      });
      const buildIndexSpy = vi.spyOn(
        engine as never,
        "buildIndexForDataset" as never,
      );

      const result = engine.sort([
        { field: "age", direction: "asc" },
        { field: "name", direction: "asc" },
      ]);

      expect(result.map((u) => u.id)).toEqual([2, 3, 1, 4]);
      expect(buildIndexSpy).not.toHaveBeenCalled();
    });

    it("clearIndexes() → multi-field sort rebuilds primary once", () => {
      const engine = new SortEngine<User>({
        data: users,
        fields: ["age"],
      });

      engine.clearIndexes();

      const buildIndexSpy = vi.spyOn(
        engine as never,
        "buildIndexForDataset" as never,
      );

      engine.sort([
        { field: "age", direction: "asc" },
        { field: "name", direction: "asc" },
      ]);

      expect(buildIndexSpy).toHaveBeenCalledTimes(1);
    });
  });
});
