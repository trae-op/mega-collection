import { describe, expect, it } from "vitest";

import { buildIntersectionQueryGrams } from "./ngram";
import { SearchArrayCollection } from "./array";

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
    interests: ["music", "gaming", null as unknown as string],
    skills: [30 as unknown as string, false as unknown as string],
  },
];

describe("SearchArrayCollection", () => {
  it("builds n-gram indexes and searches a registered array field", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["interests"]);
    collection.buildIndexes(users);

    expect(collection.hasField("interests")).toBe(true);
    expect(collection.hasField("skills")).toBe(false);

    const result = collection.searchIndexedField(
      users,
      "interests",
      "sports",
      buildIntersectionQueryGrams("sports"),
    );

    expect(result.map((u) => u.id)).toEqual(["1", "3"]);
  });

  it("searches across all registered array fields", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["interests", "skills"]);
    collection.buildIndexes(users);

    const result = collection.searchAllIndexedFieldIndices(
      "react",
      buildIntersectionQueryGrams("react"),
    );

    expect(result).toEqual(expect.arrayContaining([0, 2]));
    expect(result.length).toBe(2);
  });

  it("partial substring match", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.searchIndexedField(
      users,
      "skills",
      "rea",
      buildIntersectionQueryGrams("rea"),
    );

    expect(result.map((u) => u.id)).toEqual(["1", "3"]);
  });

  it("number values converted to searchable text", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.searchIndexedField(
      users,
      "skills",
      "30",
      buildIntersectionQueryGrams("30"),
    );

    expect(result.map((u) => u.id)).toEqual(["5"]);
  });

  it("boolean values converted to searchable text", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    const result = collection.searchIndexedField(
      users,
      "skills",
      "false",
      buildIntersectionQueryGrams("false"),
    );

    expect(result.map((u) => u.id)).toEqual(["5"]);
  });

  it("no cross-boundary matches between array elements", () => {
    const collection = new SearchArrayCollection<User>();
    const data: User[] = [
      {
        id: "1",
        name: "Test",
        interests: ["abc", "xyz"],
        skills: [],
      },
    ];

    collection.registerFields(["interests"]);
    collection.buildIndexes(data);

    const result = collection.searchFieldLinear(
      data,
      "interests",
      "c\nx",
    );

    expect(result).toEqual([]);
  });

  it("invalid entries are ignored", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["interests"]);
    collection.buildIndexes(users);

    // Eve has ["music", "gaming", null] - should find by "music" and "gaming" but not null
    const result = collection.searchIndexedField(
      users,
      "interests",
      "gaming",
      buildIntersectionQueryGrams("gaming"),
    );

    expect(result.map((u) => u.id)).toEqual(["5"]);
  });

  it("empty array field is ignored", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["interests"]);
    collection.buildIndexes(users);

    // Dan has empty interests array
    const result = collection.searchIndexedField(
      users,
      "interests",
      "sports",
      buildIntersectionQueryGrams("sports"),
    );

    expect(result.map((u) => u.id)).not.toContain("4");
  });

  it("missing field is ignored", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["nonexistent" as keyof User & string]);
    collection.buildIndexes(users);

    // Index is built but no items match, so search returns empty
    const result = collection.searchIndexedField(
      users,
      "nonexistent" as keyof User & string,
      "test",
      buildIntersectionQueryGrams("test"),
    );
    expect(result).toEqual([]);
  });

  it("falls back to linear search after clearIndexes", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["interests"]);
    collection.buildIndexes(users);
    collection.clearIndexes();

    const result = collection.searchFieldLinear(
      users,
      "interests",
      "sports",
    );

    expect(result.map((u) => u.id)).toEqual(["1", "3"]);
  });

  it("addItems then search finds newly added items", () => {
    const collection = new SearchArrayCollection<User>();
    const initialData: User[] = [
      {
        id: "1",
        name: "Alice",
        interests: ["sports"],
        skills: [],
      },
    ];

    collection.registerFields(["interests"]);
    collection.buildIndexes(initialData);

    const newItems: User[] = [
      {
        id: "2",
        name: "Bob",
        interests: ["music"],
        skills: [],
      },
    ];

    collection.addItems(newItems, 1);
    const allData = [...initialData, ...newItems];

    const result = collection.searchIndexedField(
      allData,
      "interests",
      "music",
      buildIntersectionQueryGrams("music"),
    );
    expect(result.map((u) => u.id)).toEqual(["2"]);
  });

  it("updateItem consistency", () => {
    const collection = new SearchArrayCollection<User>();
    const data: User[] = [
      {
        id: "1",
        name: "Alice",
        interests: ["sports"],
        skills: [],
      },
    ];

    collection.registerFields(["interests"]);
    collection.buildIndexes(data);

    const updatedItem: User = {
      id: "1",
      name: "Alice",
      interests: ["music"],
      skills: [],
    };

    collection.updateItem(updatedItem, data[0], 0);

    // Old value must not be found
    const oldResult = collection.searchIndexedField(
      [updatedItem],
      "interests",
      "sports",
      buildIntersectionQueryGrams("sports"),
    );
    expect(oldResult).toEqual([]);

    // New value must be found
    const newResult = collection.searchIndexedField(
      [updatedItem],
      "interests",
      "music",
      buildIntersectionQueryGrams("music"),
    );
    expect(newResult.map((u) => u.id)).toEqual(["1"]);
  });

  it("removeItem cleanup", () => {
    const collection = new SearchArrayCollection<User>();
    const data: User[] = [
      {
        id: "1",
        name: "Alice",
        interests: ["sports"],
        skills: [],
      },
      {
        id: "2",
        name: "Bob",
        interests: ["music"],
        skills: [],
      },
    ];

    collection.registerFields(["interests"]);
    collection.buildIndexes(data);

    collection.removeItem(data[0], 0);

    const result = collection.searchIndexedField(
      data,
      "interests",
      "sports",
      buildIntersectionQueryGrams("sports"),
    );
    expect(result).toEqual([]);
  });

  it("searchAllIndexedFieldIndices returns empty after clearIndexes", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["interests"]);
    collection.buildIndexes(users);
    collection.clearIndexes();

    const result = collection.searchAllIndexedFieldIndices(
      "sports",
      buildIntersectionQueryGrams("sports"),
    );
    expect(result).toEqual([]);
  });

  it("mixed array with valid and invalid entries", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["skills"]);
    collection.buildIndexes(users);

    // Eve has [30, false] - should find by "30" and "false"
    const resultNum = collection.searchIndexedField(
      users,
      "skills",
      "30",
      buildIntersectionQueryGrams("30"),
    );
    expect(resultNum.map((u) => u.id)).toEqual(["5"]);

    const resultBool = collection.searchIndexedField(
      users,
      "skills",
      "false",
      buildIntersectionQueryGrams("false"),
    );
    expect(resultBool.map((u) => u.id)).toEqual(["5"]);
  });

  it("searchFieldLinearIndices with sourceIndices", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["interests"]);

    const indices = collection.searchFieldLinearIndices(
      users,
      "interests",
      "sports",
      [0, 1, 2],
    );

    expect(indices).toEqual(expect.arrayContaining([0, 2]));
  });

  it("matchesAnyField works", () => {
    const collection = new SearchArrayCollection<User>();

    collection.registerFields(["interests", "skills"]);

    const item: User = {
      id: "1",
      name: "Alice",
      interests: ["sports"],
      skills: ["JavaScript"],
    };

    expect(collection.matchesAnyField(item, "sports")).toBe(true);
    expect(collection.matchesAnyField(item, "javascript")).toBe(true);
    expect(collection.matchesAnyField(item, "cooking")).toBe(false);
  });
});
