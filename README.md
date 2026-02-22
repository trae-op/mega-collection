# mega-collection

> High-performance search, filter & sort engine for **10 M+** item collections in JavaScript / TypeScript.

## Features

| Capability                        | Strategy                              | Complexity                         |
| --------------------------------- | ------------------------------------- | ---------------------------------- |
| **Exact key lookup**              | Hash-Map index (`Map<value, T[]>`)    | **O(1)**                           |
| **Multi-value filter**            | Index intersection + `Set` membership | **O(k)** indexed / **O(n)** linear |
| **Text search** (contains/prefix) | Trigram inverted index + verify       | **O(candidates)**                  |
| **Sorting**                       | V8 TimSort / index-sort for numerics  | **O(n log n)**                     |

## Quick start

```bash
npm install mega-collection
```

```ts
import { MegaCollection } from "mega-collection";

interface User {
  id: number;
  name: string;
  city: string;
  age: number;
}

const mc = new MegaCollection<User>({
  indexFields: ["city", "age"], // hash-map indexes
  textSearchFields: ["name"], // trigram indexes
});

mc.load(myTenMillionUsers);

// O(1) exact lookup
mc.exactLookup("city", "Kyiv");

// Text search (trigram-accelerated)
mc.textSearch("name", "john", { mode: "contains", limit: 100 });

// Multi-criteria filter (AND logic, like multiselect checkboxes)
mc.filter([
  { field: "city", values: ["Kyiv", "Lviv"] },
  { field: "age", values: [25, 30, 35] },
]);

// Sort
mc.sort([
  { field: "age", direction: "asc" },
  { field: "name", direction: "desc" },
]);
```

## API

### `new MegaCollection<T>(config?)`

| Config field       | Type       | Description                         |
| ------------------ | ---------- | ----------------------------------- |
| `indexFields`      | `string[]` | Fields to build hash-map indexes on |
| `textSearchFields` | `string[]` | Fields to build trigram indexes on  |

### Methods

| Method                            | Description                     |
| --------------------------------- | ------------------------------- |
| `load(data)`                      | Load data and build all indexes |
| `exactLookup(field, value)`       | O(1) exact-value lookup         |
| `exactLookupMulti(field, values)` | O(1) multi-value lookup         |
| `textSearch(field, query, opts?)` | Trigram-powered text search     |
| `filter(criteria)`                | Multi-criteria AND filter       |
| `sort(descriptors, inPlace?)`     | Multi-field sort                |
| `addIndex(field)`                 | Add hash-map index at runtime   |
| `addTextIndex(field)`             | Add trigram index at runtime    |
| `clearIndexes()`                  | Free index memory               |
| `destroy()`                       | Remove all data and indexes     |

### Low-level modules

You can also use the individual engines directly:

```ts
import {
  Indexer,
  TextSearchEngine,
  FilterEngine,
  SortEngine,
} from "mega-collection";
```

## Demo

Open `index.html` in a browser to try the interactive demo. It lets you:

1. Generate N items (try 100k–10M)
2. Text search by name (trigram index)
3. Multi-checkbox filter by city & department
4. Sort by any field
5. O(1) exact key lookup

## Build

```bash
npm install
npm run build        # TypeScript compile + browser bundle
```

## Architecture

```
src/
  types.ts          — Type definitions
  indexer.ts        — Hash-Map index engine (O(1) lookups)
  text-search.ts    — Trigram inverted index engine
  filter.ts         — Multi-criteria filter engine
  sorter.ts         — Sort engine (TimSort + index-sort)
  mega-collection.ts — Main API facade
  index.ts          — Barrel export
```

## License

MIT
