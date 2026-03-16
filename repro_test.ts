import { MergeEngines } from "./src/merge/merge-engines.ts";
import { FilterEngine } from "./src/filter/filter.ts";
import { TextSearchEngine } from "./src/search/text-search.ts";
import { SortEngine } from "./src/sort/sorter.ts";

type User = {
  id: number;
  name: string;
  city: string;
  age: number;
  createdAt?: Date;
  updatedAt?: Date;
};

const users: User[] = [];
const names = [
  "John",
  "Emma",
  "Liam",
  "Olivia",
  "Noah",
  "Sophia",
  "Mason",
  "Ava",
  "Lucas",
  "Mia",
];
const cities = ["New York", "Los Angeles", "Chicago", "Miami", "San Francisco"];
const ages = [22, 26, 30, 34, 38, 42];
for (let i = 0; i < 100000; i++) {
  const now = Date.now();
  users.push({
    id: i + 1,
    name: `${names[i % names.length]} ${i + 1}`,
    city: cities[i % cities.length],
    age: ages[i % ages.length],
    createdAt: new Date(now - Math.random() * 1000 * 60 * 60 * 24 * 365),
    updatedAt: new Date(),
  });
}

const engine = new MergeEngines<User>({
  imports: [TextSearchEngine, SortEngine, FilterEngine],
  data: users,
  filterByPreviousResult: true,
  search: { fields: ["name", "city"], minQueryLength: 2 },
  filter: { fields: ["city", "age"] },
  sort: { fields: ["age", "name", "city"] },
});

console.log("Dataset length:", users.length);

// Simulate what the React useMemo does:
// search('') + filter([]) + sort by createdAt (NOT in indexedFields)
const result1 = engine
  .search("")
  .filter([])
  .sort([{ field: "createdAt", direction: "desc" }]);
console.log("Result1 length:", result1.length);

// Now add a new item (this is what triggers the error)
try {
  engine.add([
    {
      id: Date.now(),
      name: "Alice",
      age: 25,
      city: "Boston",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  console.log("Add succeeded. Dataset length:", users.length);
} catch (e: any) {
  console.error("Error during add:", e.message);
}

// Another scenario: sort by 'age' (which IS in indexedFields) then add
console.log("\n--- Testing sort by indexed field + add ---");
const result2 = engine
  .search("")
  .filter([])
  .sort([{ field: "age", direction: "asc" }]);
console.log("Result2 length:", result2.length);

try {
  engine.add([
    {
      id: Date.now() + 1,
      name: "Bob",
      age: 30,
      city: "Chicago",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  console.log("Add 2 succeeded. Dataset length:", users.length);
} catch (e: any) {
  console.error("Error during add 2:", e.message);
}
