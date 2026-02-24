import { describe, expect, it } from "vitest";

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

    const result = engine.filter(users, []);

    expect(result).toBe(users);
  });

  it("filters via indexed criteria with AND logic", () => {
    const engine = new FilterEngine<User>()
      .buildIndex(users, "city")
      .buildIndex(users, "age");

    const result = engine.filter(users, [
      { field: "city", values: ["Kyiv", "Lviv"] },
      { field: "age", values: [30] },
    ]);

    expect(result.map((item) => item.id)).toEqual([2, 3]);
  });

  it("supports mixed path: indexed pre-filter + linear criteria", () => {
    const engine = new FilterEngine<User>().buildIndex(users, "city");

    const result = engine.filter(users, [
      { field: "city", values: ["Kyiv", "Lviv"] },
      { field: "active", values: [true] },
    ]);

    expect(result.map((item) => item.id)).toEqual([1, 3, 5]);
  });

  it("supports pure linear filtering when no indexes exist", () => {
    const engine = new FilterEngine<User>();

    const result = engine.filter(users, [
      { field: "city", values: ["Kyiv", "Odesa"] },
      { field: "age", values: [25] },
    ]);

    expect(result.map((item) => item.id)).toEqual([1, 4]);
  });
});
