import { describe, expect, it } from "vitest";

import { FilterNestedCollection } from "./nested";

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

describe("FilterNestedCollection", () => {
  it("registers only dot-notation fields and filters via nested indexes", () => {
    const nestedCollection = new FilterNestedCollection<UserWithOrders>();

    nestedCollection.registerFields(["orders.status", "name"]);
    nestedCollection.buildIndexes(usersWithOrders);

    expect(nestedCollection.hasField("orders.status")).toBe(true);
    expect(nestedCollection.hasField("name")).toBe(false);

    const result = nestedCollection.filter(
      usersWithOrders,
      [{ field: "orders.status", values: ["pending"] }],
      usersWithOrders,
    );

    expect(result.map((user) => user.id)).toEqual(["1", "2"]);
  });

  it("falls back to linear nested filtering after indexes are cleared", () => {
    const nestedCollection = new FilterNestedCollection<UserWithOrders>();

    nestedCollection.registerFields(["orders.status"]);
    nestedCollection.buildIndexes(usersWithOrders);
    nestedCollection.clearIndexes();

    const result = nestedCollection.filter(
      usersWithOrders,
      [{ field: "orders.status", values: ["delivered"] }],
      usersWithOrders,
    );

    expect(result.map((user) => user.id)).toEqual(["1"]);
  });
});
