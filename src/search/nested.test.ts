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
});
