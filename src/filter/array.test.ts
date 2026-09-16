import { describe, expect, it } from "vitest";

import { FilterArrayCollection } from "./array";

type User = {
  id: string;
  name: string;
  interests: string[];
  skills: string[];
};

const users: User[] = [
  {
    id: "1",
    name: "Alice",
    interests: ["sports", "music"],
    skills: ["JavaScript", "React"],
  },
  {
    id: "2",
    name: "Bob",
    interests: ["reading", "cooking"],
    skills: ["Python", "Django"],
  },
  {
    id: "3",
    name: "Cara",
    interests: ["sports", "travel"],
    skills: ["React", "Node.js"],
  },
  {
    id: "4",
    name: "Dan",
    interests: [],
    skills: ["JavaScript"],
  },
  {
    id: "5",
    name: "Eve",
    interests: ["music", "gaming"],
    skills: [30 as unknown as string, false as unknown as string],
  },
];

describe("FilterArrayCollection", () => {
  it("registers array fields and filters via indexed lookup", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    expect(collection.hasField("skills")).toBe(true);
    expect(collection.hasField("interests")).toBe(false);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["React"] }],
      users,
    );

    expect(result.map((u) => u.id)).toEqual(["1", "3"]);
  });

  it("AND semantics: two selected values", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["JavaScript", "React"] }],
      users,
    );

    // Only Alice has both JavaScript AND React
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  it("AND semantics: three selected values", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["React", "Node.js"] }],
      users,
    );

    // Only Cara has both React AND Node.js
    expect(result.map((u) => u.id)).toEqual(["3"]);
  });

  it("partial match does NOT filter (exact match only)", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["Rea"] }],
      users,
    );

    // "Rea" is not an exact match for "React"
    expect(result).toEqual([]);
  });

  it("only some selected values present → no match", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["JavaScript", "React", "Node.js"] }],
      users,
    );

    // No single user has all three skills
    expect(result).toEqual([]);
  });

  it("exact string matching", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["JavaScript"] }],
      users,
    );

    expect(result.map((u) => u.id)).toEqual(["1", "4"]);
  });

  it("exact number matching", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: [30] }],
      users,
    );

    expect(result.map((u) => u.id)).toEqual(["5"]);
  });

  it("exact boolean matching", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: [false] }],
      users,
    );

    expect(result.map((u) => u.id)).toEqual(["5"]);
  });

  it("30 (number) !== '30' (string)", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["30"] }],
      users,
    );

    expect(result).toEqual([]);
  });

  it("false (boolean) !== 'false' (string)", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["false"] }],
      users,
    );

    expect(result).toEqual([]);
  });

  it("invalid entries ignored", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    // Eve has [30, false] - filtering by valid primitive values works
    const result = collection.filter(
      users,
      [{ field: "skills", values: [30] }],
      users,
    );

    expect(result.map((u) => u.id)).toEqual(["5"]);
  });

  it("empty array field", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["interests"]);
    collection.buildIndexes(users);

    // Dan has empty interests
    const result = collection.filter(
      users,
      [{ field: "interests", values: ["sports"] }],
      users,
    );

    expect(result.map((u) => u.id)).not.toContain("4");
  });

  it("missing field", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["nonexistent" as keyof User & string]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "nonexistent" as keyof User & string, values: ["test"] }],
      users,
    );

    expect(result).toEqual([]);
  });

  it("falls back to linear filtering after clearIndexes", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);
    collection.clearIndexes();

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["React"] }],
      users,
    );

    expect(result.map((u) => u.id)).toEqual(["1", "3"]);
  });

  it("addItems then filter", () => {
    const collection = new FilterArrayCollection<User>();
    const initialData: User[] = [
      {
        id: "1",
        name: "Alice",
        interests: ["sports"],
        skills: ["JavaScript"],
      },
    ];

    collection.registerFields(["skills"]);
    collection.buildIndexes(initialData);

    const newItems: User[] = [
      {
        id: "2",
        name: "Bob",
        interests: [],
        skills: ["Python"],
      },
    ];

    collection.addItems(newItems);

    const result = collection.filter(
      [...initialData, ...newItems],
      [{ field: "skills", values: ["Python"] }],
      [...initialData, ...newItems],
    );

    expect(result.map((u) => u.id)).toEqual(["2"]);
  });

  it("updateItem consistency", () => {
    const collection = new FilterArrayCollection<User>();
    const data: User[] = [
      {
        id: "1",
        name: "Alice",
        interests: ["sports"],
        skills: ["JavaScript"],
      },
    ];

    collection.registerFields(["skills"]);
    collection.buildIndexes(data);

    const updatedItem: User = {
      id: "1",
      name: "Alice",
      interests: ["sports"],
      skills: ["Python"],
    };

    collection.updateItem(updatedItem, data[0]);

    // Old value must not match
    const oldResult = collection.filter(
      [updatedItem],
      [{ field: "skills", values: ["JavaScript"] }],
      [updatedItem],
    );
    expect(oldResult).toEqual([]);

    // New value must match
    const newResult = collection.filter(
      [updatedItem],
      [{ field: "skills", values: ["Python"] }],
      [updatedItem],
    );
    expect(newResult.map((u) => u.id)).toEqual(["1"]);
  });

  it("removeItem cleanup", () => {
    const collection = new FilterArrayCollection<User>();
    const data: User[] = [
      {
        id: "1",
        name: "Alice",
        interests: ["sports"],
        skills: ["JavaScript"],
      },
      {
        id: "2",
        name: "Bob",
        interests: [],
        skills: ["Python"],
      },
    ];

    collection.registerFields(["skills"]);
    collection.buildIndexes(data);

    collection.removeItem(data[0]);

    const result = collection.filter(
      data,
      [{ field: "skills", values: ["JavaScript"] }],
      data,
    );
    expect(result).toEqual([]);
  });

  it("exclude: items with any excluded array value are removed", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["JavaScript", "React"], exclude: ["React"] }],
      users,
    );

    // JavaScript users are 1 and 4, but 1 also has React (excluded)
    expect(result.map((u) => u.id)).toEqual(["4"]);
  });

  it("duplicate selected values do not change the result", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: ["React", "React"] }],
      users,
    );

    expect(result.map((u) => u.id)).toEqual(["1", "3"]);
  });

  it("empty values array is unsatisfiable", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [{ field: "skills", values: [] }],
      users,
    );

    expect(result).toEqual([]);
  });

  it("combined criteria across multiple array fields (AND)", () => {
    const collection = new FilterArrayCollection<User>();

    collection.registerFields(["interests", "skills"]);
    collection.buildIndexes(users);

    const result = collection.filter(
      users,
      [
        { field: "interests", values: ["sports"] },
        { field: "skills", values: ["JavaScript"] },
      ],
      users,
    );

    // Only Alice has both sports AND JavaScript
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  it("linear fallback produces identical results", () => {
    const collectionIndexed = new FilterArrayCollection<User>();
    collectionIndexed.registerFields(["skills"]);
    collectionIndexed.buildIndexes(users);

    const collectionLinear = new FilterArrayCollection<User>();
    collectionLinear.registerFields(["skills"]);
    // No buildIndexes call — forces linear path

    const criteria = [
      { field: "skills" as keyof User & string, values: ["JavaScript", "React"] },
    ];

    const resultIndexed = collectionIndexed.filter(users, criteria, users);
    const resultLinear = collectionLinear.filter(users, criteria, users);

    expect(resultIndexed.map((u) => u.id)).toEqual(resultLinear.map((u) => u.id));
  });

  it("linear fallback with empty values is unsatisfiable", () => {
    const collection = new FilterArrayCollection<User>();
    collection.registerFields(["skills"]);
    // No buildIndexes call — forces linear path

    const result = collection.filter(
      users,
      [{ field: "skills", values: [] }],
      users,
    );

    expect(result).toEqual([]);
  });
});
