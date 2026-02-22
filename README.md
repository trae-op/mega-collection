# @devisfuture/mega-collection

> High-performance search, filter & sort engine for **10 M+** item collections in JavaScript / TypeScript.

Zero dependencies. Tree-shakeable. Import only what you need.

## Features

| Capability                 | Strategy                              | Complexity                         |
| -------------------------- | ------------------------------------- | ---------------------------------- |
| **Exact key lookup**       | Hash-Map index (`Map<value, T[]>`)    | **O(1)**                           |
| **Multi-value filter**     | Index intersection + `Set` membership | **O(k)** indexed / **O(n)** linear |
| **Text search** (contains) | Trigram inverted index + verify       | **O(candidates)**                  |
| **Sorting**                | V8 TimSort / index-sort for numerics  | **O(n log n)**                     |

## Install

```bash
npm install @devisfuture/mega-collection
```

## Quick Start — Full Package

```ts
import { MegaCollection } from "@devisfuture/mega-collection";

interface User {
  id: number;
  name: string;
  city: string;
  age: number;
}

const mc = new MegaCollection<User>({
  indexFields: ["city", "age"],
  textSearchFields: ["name"],
});

mc.load(myTenMillionUsers);

// O(1) exact lookup
mc.exactLookup("city", "Kyiv");

// Text search (trigram-accelerated)
mc.textSearch("name", "john");

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

## Modular Imports (Tree-Shaking)

Like `lodash` — import only the module you need so your bundle stays small:

### Search only

```ts
import { Indexer, TextSearchEngine } from "@devisfuture/mega-collection/search";

const indexer = new Indexer<User>();
indexer.buildIndex(users, "city");
indexer.getByValue("city", "Kyiv"); // O(1) exact lookup

const search = new TextSearchEngine<User>();
search.buildIndex(users, "name");
search.search("name", "john");
```

### Filter only

```ts
import { FilterEngine, Indexer } from "@devisfuture/mega-collection/filter";

const indexer = new Indexer<User>();
indexer.buildIndex(users, "city");
indexer.buildIndex(users, "age");

const filter = new FilterEngine<User>(indexer);
filter.filter(users, [
  { field: "city", values: ["Kyiv", "Lviv"] },
  { field: "age", values: [25, 30, 35] },
]);
```

### Sort only

```ts
import { SortEngine } from "@devisfuture/mega-collection/sort";

const sorter = new SortEngine<User>();
const sorted = sorter.sort(users, [
  { field: "age", direction: "asc" },
  { field: "name", direction: "desc" },
]);
```

## API Reference

### `MegaCollection<T>` (main facade)

#### `new MegaCollection<T>(config?)`

| Config field       | Type       | Description                         |
| ------------------ | ---------- | ----------------------------------- |
| `indexFields`      | `string[]` | Fields to build hash-map indexes on |
| `textSearchFields` | `string[]` | Fields to build trigram indexes on  |

#### Methods

| Method                            | Description                     |
| --------------------------------- | ------------------------------- |
| `load(data)`                      | Load data and build all indexes |
| `exactLookup(field, value)`       | O(1) exact-value lookup         |
| `exactLookupMulti(field, values)` | O(1) multi-value lookup         |
| `textSearch(field, query)`        | Trigram-powered text search     |
| `filter(criteria)`                | Multi-criteria AND filter       |
| `sort(descriptors, inPlace?)`     | Multi-field sort                |
| `addIndex(field)`                 | Add hash-map index at runtime   |
| `addTextIndex(field)`             | Add trigram index at runtime    |
| `clearIndexes()`                  | Free index memory               |
| `destroy()`                       | Remove all data and indexes     |

### `Indexer<T>` (search module)

Hash-map index engine for O(1) exact-key lookups.

| Method                       | Description                   |
| ---------------------------- | ----------------------------- |
| `buildIndex(data, field)`    | Build index for a field. O(n) |
| `getByValue(field, value)`   | O(1) single-value lookup      |
| `getByValues(field, values)` | O(k) multi-value lookup       |
| `hasIndex(field)`            | Check whether an index exists |
| `clear()`                    | Free all index memory         |

### `TextSearchEngine<T>` (search module)

Trigram-based text search engine.

| Method                    | Description                             |
| ------------------------- | --------------------------------------- |
| `buildIndex(data, field)` | Build trigram index for a field. O(n·L) |
| `search(field, query)`    | Trigram-accelerated search              |
| `hasIndex(field)`         | Check whether index exists              |
| `clear()`                 | Free memory                             |

### `FilterEngine<T>` (filter module)

Multi-criteria AND filter with index-accelerated fast path.

| Method                   | Description           |
| ------------------------ | --------------------- |
| `filter(data, criteria)` | Apply filter criteria |

### `SortEngine<T>` (sort module)

High-performance sorting with pre-compiled comparators.

| Method                              | Description      |
| ----------------------------------- | ---------------- |
| `sort(data, descriptors, inPlace?)` | Multi-field sort |

## Types

All types are exported from the main package and from each sub-module:

```ts
import type {
  CollectionItem,
  MegaCollectionConfig,
  FilterCriterion,
  SortDescriptor,
  SortDirection,
  IndexableKey,
} from "@devisfuture/mega-collection";
```

## Architecture

```
src/
  types.ts               — Shared type definitions
  indexer.ts              — Hash-Map index engine (O(1) lookups)
  search/
    text-search.ts       — Trigram inverted index engine
    index.ts             — Search module entry point
  filter/
    filter.ts            — Multi-criteria filter engine
    index.ts             — Filter module entry point
  sort/
    sorter.ts            — Sort engine (TimSort + index-sort)
    index.ts             — Sort module entry point
  mega-collection.ts     — Main API facade
  index.ts               — Main barrel export
```

## Build

```bash
npm install
npm run build          # Build CJS + ESM + declarations
npm run typecheck      # Type-check without emitting
npm run dev            # Watch mode
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for our security policy.

## License

MIT — see [LICENSE](LICENSE) for details.
