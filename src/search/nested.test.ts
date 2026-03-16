import { describe, expect, it } from "vitest";

import { buildIntersectionQueryGrams } from "./ngram";
import { SearchNestedCollection } from "./nested";

type Order = {
  id: string;
  status: string;
};

type UserWithOrders = {
  id: string;
  name: string;
  orders: Order[];
};

const usersWithOrders: UserWithOrders[] = [
  {
    id: "1",
    name: "Tim",
    orders: [
      { id: "1", status: "pending" },
      { id: "2", status: "delivered" },
    ],
  },
  {
    id: "2",
    name: "Tom",
    orders: [{ id: "3", status: "pending" }],
  },
  {
    id: "3",
    name: "Sara",
    orders: [],
  },
];

describe("SearchNestedCollection", () => {
  it("builds nested n-gram indexes and searches a registered field", () => {
    const nestedCollection = new SearchNestedCollection<UserWithOrders>();

    nestedCollection.registerFields(["orders.status", "name"]);
    nestedCollection.buildIndexes(usersWithOrders);

    expect(nestedCollection.hasField("orders.status")).toBe(true);
    expect(nestedCollection.hasField("name")).toBe(false);

    const result = nestedCollection.searchIndexedField(
      usersWithOrders,
      "orders.status",
      "pending",
      buildIntersectionQueryGrams("pending"),
    );

    expect(result.map((user) => user.id)).toEqual(["1", "2"]);
  });

  it("falls back to linear nested search after indexes are cleared", () => {
    const nestedCollection = new SearchNestedCollection<UserWithOrders>();

    nestedCollection.registerFields(["orders.status"]);
    nestedCollection.buildIndexes(usersWithOrders);
    nestedCollection.clearIndexes();

    const result = nestedCollection.searchFieldLinear(
      usersWithOrders,
      "orders.status",
      "delivered",
    );

    expect(result.map((user) => user.id)).toEqual(["1"]);
  });

  it("consistent indexing after updateItem", () => {
    const nestedCollection = new SearchNestedCollection<UserWithOrders>();
    const data: UserWithOrders[] = [
      {
        id: "1",
        name: "Alice",
        orders: [{ id: "o1", status: "pending" }],
      },
    ];

    nestedCollection.registerFields(["orders.status"]);
    nestedCollection.buildIndexes(data);

    const updatedItem: UserWithOrders = {
      id: "1",
      name: "Alice",
      orders: [{ id: "o1", status: "shipped" }],
    };

    nestedCollection.updateItem(updatedItem, data[0], 0);

    // Old value must not be found
    const oldResult = nestedCollection.searchIndexedField(
      [updatedItem],
      "orders.status",
      "pending",
      buildIntersectionQueryGrams("pending"),
    );
    expect(oldResult).toEqual([]);

    // New value must be found
    const newResult = nestedCollection.searchIndexedField(
      [updatedItem],
      "orders.status",
      "shipped",
      buildIntersectionQueryGrams("shipped"),
    );
    expect(newResult.map((u) => u.id)).toEqual(["1"]);
  });

  it("removeItem cleanup — item is no longer reachable", () => {
    const nestedCollection = new SearchNestedCollection<UserWithOrders>();
    const data: UserWithOrders[] = [
      {
        id: "1",
        name: "Alice",
        orders: [{ id: "o1", status: "pending" }],
      },
      {
        id: "2",
        name: "Bob",
        orders: [{ id: "o2", status: "delivered" }],
      },
    ];

    nestedCollection.registerFields(["orders.status"]);
    nestedCollection.buildIndexes(data);

    nestedCollection.removeItem(data[0], 0);

    const result = nestedCollection.searchIndexedField(
      data,
      "orders.status",
      "pending",
      buildIntersectionQueryGrams("pending"),
    );
    expect(result).toEqual([]);
  });

  it("searchAllIndexedFieldIndices returns empty after clearIndexes", () => {
    const nestedCollection = new SearchNestedCollection<UserWithOrders>();

    nestedCollection.registerFields(["orders.status"]);
    nestedCollection.buildIndexes(usersWithOrders);
    nestedCollection.clearIndexes();

    const result = nestedCollection.searchAllIndexedFieldIndices(
      "pending",
      buildIntersectionQueryGrams("pending"),
    );
    expect(result).toEqual([]);
  });

  it("addItems then search finds newly added items", () => {
    const nestedCollection = new SearchNestedCollection<UserWithOrders>();
    const initialData: UserWithOrders[] = [
      {
        id: "1",
        name: "Alice",
        orders: [{ id: "o1", status: "pending" }],
      },
    ];

    nestedCollection.registerFields(["orders.status"]);
    nestedCollection.buildIndexes(initialData);

    const newItems: UserWithOrders[] = [
      {
        id: "2",
        name: "Bob",
        orders: [{ id: "o2", status: "completed" }],
      },
    ];

    nestedCollection.addItems(newItems, 1);
    const allData = [...initialData, ...newItems];

    const result = nestedCollection.searchIndexedField(
      allData,
      "orders.status",
      "completed",
      buildIntersectionQueryGrams("completed"),
    );
    expect(result.map((u) => u.id)).toEqual(["2"]);
  });

  it("multi-nested-value join does not produce cross-boundary false positives", () => {
    const nestedCollection = new SearchNestedCollection<UserWithOrders>();
    const data: UserWithOrders[] = [
      {
        id: "1",
        name: "Alice",
        orders: [
          { id: "o1", status: "abc" },
          { id: "o2", status: "xyz" },
        ],
      },
    ];

    nestedCollection.registerFields(["orders.status"]);
    nestedCollection.buildIndexes(data);

    // Individual values are found
    const resultAbc = nestedCollection.searchFieldLinear(
      data,
      "orders.status",
      "abc",
    );
    expect(resultAbc.map((u) => u.id)).toEqual(["1"]);

    const resultXyz = nestedCollection.searchFieldLinear(
      data,
      "orders.status",
      "xyz",
    );
    expect(resultXyz.map((u) => u.id)).toEqual(["1"]);

    // Cross-boundary query must NOT match
    const crossBoundary = nestedCollection.searchFieldLinear(
      data,
      "orders.status",
      "c\nx",
    );
    expect(crossBoundary).toEqual([]);
  });
});
