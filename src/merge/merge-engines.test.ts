import { describe, expect, it } from "vitest";

import { FilterEngine } from "../filter/filter";
import { TextSearchEngine } from "../search/text-search";
import { SortEngine } from "../sort/sorter";
import { MergeEngines } from "./merge-engines";

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

  it("throws when calling a method whose engine was not imported", () => {
    const searchOnly = new MergeEngines<User>({
      imports: [TextSearchEngine],
      data: users,
      search: { fields: ["name"] },
    });

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
});
