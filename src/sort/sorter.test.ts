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
});
