import { describe, expect, it } from "vitest";

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
  it("returns input data when descriptors is empty", () => {
    const engine = new SortEngine<User>();

    const result = engine.sort(users, []);

    expect(result).toBe(users);
  });

  it("sorts by single numeric field ascending without mutating by default", () => {
    const engine = new SortEngine<User>();

    const result = engine.sort(users, [{ field: "age", direction: "asc" }]);

    expect(result.map((item) => item.id)).toEqual([2, 3, 1, 4]);
    expect(users.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(result).not.toBe(users);
  });

  it("sorts by single numeric field descending", () => {
    const engine = new SortEngine<User>();

    const result = engine.sort(users, [{ field: "age", direction: "desc" }]);

    expect(result.map((item) => item.id)).toEqual([4, 1, 3, 2]);
  });

  it("sorts by multiple fields in order", () => {
    const engine = new SortEngine<User>();

    const result = engine.sort(users, [
      { field: "age", direction: "asc" },
      { field: "name", direction: "asc" },
    ]);

    expect(result.map((item) => item.id)).toEqual([2, 3, 1, 4]);
  });

  it("mutates input when inPlace is true", () => {
    const engine = new SortEngine<User>();
    const inPlaceUsers = [...users];

    const result = engine.sort(
      inPlaceUsers,
      [{ field: "name", direction: "asc" }],
      true,
    );

    expect(result).toBe(inPlaceUsers);
    expect(inPlaceUsers.map((item) => item.id)).toEqual([2, 4, 3, 1]);
  });

  describe("buildIndex (cached fast path)", () => {
    it("sorts ascending via cached index — O(n)", () => {
      const engine = new SortEngine<User>().buildIndex(users, "age");

      const result = engine.sort(users, [{ field: "age", direction: "asc" }]);

      expect(result.map((item) => item.id)).toEqual([2, 3, 1, 4]);
      expect(result).not.toBe(users);
    });

    it("sorts descending via cached index — O(n) reverse", () => {
      const engine = new SortEngine<User>().buildIndex(users, "age");

      const result = engine.sort(users, [{ field: "age", direction: "desc" }]);

      expect(result.map((item) => item.id)).toEqual([4, 1, 3, 2]);
    });

    it("sorts string field via cached index", () => {
      const engine = new SortEngine<User>().buildIndex(users, "name");

      const result = engine.sort(users, [{ field: "name", direction: "asc" }]);

      expect(result.map((item) => item.id)).toEqual([2, 4, 3, 1]);
    });

    it("skips cache when data reference changes", () => {
      const engine = new SortEngine<User>().buildIndex(users, "age");
      const otherUsers = [
        ...users,
        { id: 5, name: "Zara", city: "Dnipro", age: 20 },
      ];

      const result = engine.sort(otherUsers, [
        { field: "age", direction: "asc" },
      ]);

      expect(result.map((item) => item.id)).toEqual([5, 2, 3, 1, 4]);
    });

    it("skips cache when indexed array length changes in place", () => {
      const mutableUsers = users.map((user) => ({ ...user }));
      const engine = new SortEngine<User>().buildIndex(mutableUsers, "age");

      mutableUsers.push({ id: 5, name: "Zara", city: "Dnipro", age: 20 });

      const result = engine.sort(mutableUsers, [
        { field: "age", direction: "asc" },
      ]);

      expect(result.map((item) => item.id)).toEqual([5, 2, 3, 1, 4]);
    });

    it("skips cache when indexed field values change in place", () => {
      const mutableUsers = users.map((user) => ({ ...user }));
      const engine = new SortEngine<User>().buildIndex(mutableUsers, "age");

      mutableUsers[0].age = 18;

      const result = engine.sort(mutableUsers, [
        { field: "age", direction: "asc" },
      ]);

      expect(result.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    });

    it("clearIndexes frees the cache", () => {
      const engine = new SortEngine<User>().buildIndex(users, "age");
      engine.clearIndexes();

      // After clearing, still works (falls back to radix sort)
      const result = engine.sort(users, [{ field: "age", direction: "asc" }]);

      expect(result.map((item) => item.id)).toEqual([2, 3, 1, 4]);
    });

    it("supports chaining buildIndex for multiple fields", () => {
      const engine = new SortEngine<User>()
        .buildIndex(users, "age")
        .buildIndex(users, "name");

      const byAge = engine.sort(users, [{ field: "age", direction: "desc" }]);
      const byName = engine.sort(users, [{ field: "name", direction: "asc" }]);

      expect(byAge.map((item) => item.id)).toEqual([4, 1, 3, 2]);
      expect(byName.map((item) => item.id)).toEqual([2, 4, 3, 1]);
    });
  });

  describe("constructor shorthand (data + fields)", () => {
    it("builds indexes automatically when data and fields are provided", () => {
      const engine = new SortEngine<User>({
        data: users,
        fields: ["age", "name"],
      });

      const byAge = engine.sort(users, [{ field: "age", direction: "asc" }]);
      const byName = engine.sort(users, [{ field: "name", direction: "asc" }]);

      expect(byAge.map((item) => item.id)).toEqual([2, 3, 1, 4]);
      expect(byName.map((item) => item.id)).toEqual([2, 4, 3, 1]);
    });

    it("buildIndex(field) reuses constructor data", () => {
      const engine = new SortEngine<User>({ data: users });
      engine.buildIndex("age");

      const result = engine.sort(users, [{ field: "age", direction: "desc" }]);

      expect(result.map((item) => item.id)).toEqual([4, 1, 3, 2]);
    });

    it("buildIndex(field) throws when no dataset is in memory", () => {
      const engine = new SortEngine<User>();
      let caughtMessage = "";
      try {
        engine.buildIndex("age");
      } catch (err) {
        caughtMessage = err instanceof Error ? err.message : String(err);
      }
      expect(caughtMessage).toContain("no dataset in memory");
    });
  });
});
