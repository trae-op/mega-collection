# @devisfuture/mega-collection

> High-performance search, filter & sort engine for **10 M+** item collections in JavaScript / TypeScript.

Zero dependencies. Tree-shakeable. Import only what you need.

## Features

| Capability                 | Strategy                               | Complexity                         |
| -------------------------- | -------------------------------------- | ---------------------------------- |
| **Indexed filter**         | Hash-Map index (`Map<value, T[]>`)     | **O(1)**                           |
| **Multi-value filter**     | Index intersection + `Set` membership  | **O(k)** indexed / **O(n)** linear |
| **Text search** (contains) | Trigram inverted index + verify        | **O(candidates)**                  |
| **Sorting**                | Pre-sorted index (cached) / V8 TimSort | **O(n)** cached / **O(n log n)**   |

## Install

```bash
npm install @devisfuture/mega-collection
```

## Quick Start

```ts
interface User {
  id: number;
  name: string;
  city: string;
  age: number;
}
```

### All-in-one: `MergeEngines`

Use `MergeEngines` to combine search, filter and sort around a single shared dataset.
Declare which engines you need in `imports` — only those are initialised.

```ts
import { MergeEngines } from "@devisfuture/mega-collection";
import { TextSearchEngine } from "@devisfuture/mega-collection/search";
import { SortEngine } from "@devisfuture/mega-collection/sort";
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const engine = new MergeEngines<User>({
  imports: [TextSearchEngine, SortEngine, FilterEngine],
  data: users,
  search: { fields: ["name", "city"], minQueryLength: 2 },
  filter: { fields: ["city", "age"], filterByPreviousResult: true },
  sort: { fields: ["age", "name", "city"] },
});

// dataset is passed once at init — no need to repeat it in every call
engine.search("john");
engine.sort([{ field: "age", direction: "asc" }]);
engine.filter([{ field: "city", values: ["Kyiv", "Lviv"] }]);
```

---

### Search only

```ts
import { TextSearchEngine } from "@devisfuture/mega-collection/search";

const search = new TextSearchEngine<User>({
  data: users,
  fields: ["name", "city"],
  minQueryLength: 2,
});

search.search("john"); // searches all indexed fields, deduplicated
search.search("name", "john"); // searches a specific field
```

### Filter only

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const filter = new FilterEngine<User>({
  data: users,
  fields: ["city", "age"],
  filterByPreviousResult: true,
});

filter.filter([
  { field: "city", values: ["Kyiv", "Lviv"] },
  { field: "age", values: [25, 30, 35] },
]);

// Sequential mode example:
// 1) First call filters by city
const byCity = filter.filter([{ field: "city", values: ["Dnipro"] }]);
// 2) Second call filters only inside previous result
const byCityAndAge = filter.filter([{ field: "age", values: [22] }]);
```

### Sort only

```ts
import { SortEngine } from "@devisfuture/mega-collection/sort";

const sorter = new SortEngine<User>({
  data: users,
  fields: ["age", "name", "city"],
});

// Single-field sort — O(n) via cached index
sorter.sort([{ field: "age", direction: "asc" }]);

// Multi-field sort — O(n log n)
sorter.sort([
  { field: "age", direction: "asc" },
  { field: "name", direction: "desc" },
]);
```

---

## API Reference

### `MergeEngines<T>` (root module)

Unified facade that composes all three engines around a shared dataset.

**Constructor options:**

| Option    | Type                                                        | Description                                  |
| --------- | ----------------------------------------------------------- | -------------------------------------------- |
| `imports` | `(typeof TextSearchEngine \| SortEngine \| FilterEngine)[]` | Engine classes to activate                   |
| `data`    | `T[]`                                                       | Shared dataset — passed once at construction |
| `search`  | `{ fields, minQueryLength? }`                               | Config for TextSearchEngine                  |
| `filter`  | `{ fields, filterByPreviousResult? }`                       | Config for FilterEngine                      |
| `sort`    | `{ fields }`                                                | Config for SortEngine                        |

**Methods:**

| Method                              | Description                                        |
| ----------------------------------- | -------------------------------------------------- |
| `search(query)`                     | Search all indexed fields                          |
| `search(field, query)`              | Search a specific field                            |
| `sort(descriptors)`                 | Sort using stored dataset                          |
| `sort(data, descriptors, inPlace?)` | Sort with an explicit dataset                      |
| `filter(criteria)`                  | Filter using stored dataset                        |
| `filter(data, criteria)`            | Filter with an explicit dataset                    |
| `getSearchEngine()`                 | Access the underlying `TextSearchEngine` or `null` |
| `getSortEngine()`                   | Access the underlying `SortEngine` or `null`       |
| `getFilterEngine()`                 | Access the underlying `FilterEngine` or `null`     |

---

### `TextSearchEngine<T>` (search module)

Trigram-based text search engine.

| Method                    | Description                              |
| ------------------------- | ---------------------------------------- |
| `buildIndex(data, field)` | Build trigram index for a field — O(n·L) |
| `buildIndex(field)`       | Same, reuses dataset from constructor    |
| `search(query)`           | Search all indexed fields, deduplicated  |
| `search(field, query)`    | Search a specific indexed field          |
| `hasIndex(field)`         | Check whether a trigram index exists     |
| `clear()`                 | Free memory                              |

### `FilterEngine<T>` (filter module)

Multi-criteria AND filter with index-accelerated fast path.

Constructor option highlights:

| Option                   | Type      | Description                                                            |
| ------------------------ | --------- | ---------------------------------------------------------------------- |
| `filterByPreviousResult` | `boolean` | When `true`, each `filter(criteria)` call filters from previous result |

| Method                    | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `buildIndex(data, field)` | Build hash-map index for a field — O(n)              |
| `buildIndex(field)`       | Same, reuses dataset from constructor                |
| `filter(criteria)`        | Filter using stored dataset                          |
| `filter(data, criteria)`  | Filter with an explicit dataset                      |
| `resetFilterState()`      | Reset previous-result state for sequential filtering |
| `clearIndexes()`          | Free all index memory                                |

### `SortEngine<T>` (sort module)

High-performance sorting with pre-compiled comparators and cached sort indexes.

| Method                              | Description                             |
| ----------------------------------- | --------------------------------------- |
| `buildIndex(data, field)`           | Pre-sort index for a field — O(n log n) |
| `buildIndex(field)`                 | Same, reuses dataset from constructor   |
| `sort(descriptors)`                 | Sort using stored dataset               |
| `sort(data, descriptors, inPlace?)` | Sort with an explicit dataset           |
| `clearIndexes()`                    | Free all cached indexes                 |

---

## Types

All types are exported from the root package and from each sub-module:

```ts
import type {
  CollectionItem,
  IndexableKey,
  FilterCriterion,
  SortDescriptor,
  SortDirection,
  MergeEnginesOptions,
} from "@devisfuture/mega-collection";
```

Or from individual sub-modules:

```ts
import type {
  CollectionItem,
  IndexableKey,
} from "@devisfuture/mega-collection/search";
import type { FilterCriterion } from "@devisfuture/mega-collection/filter";
import type {
  SortDescriptor,
  SortDirection,
} from "@devisfuture/mega-collection/sort";
```

---

## Architecture

```
src/
  types.ts               — Shared type definitions
  indexer.ts             — Hash-Map index engine (internal, O(1) lookups)
  search/
    text-search.ts       — Trigram inverted index engine
    index.ts             — Search module entry point
  filter/
    filter.ts            — Multi-criteria filter engine (owns Indexer internally)
    index.ts             — Filter module entry point
  sort/
    sorter.ts            — Sort engine (TimSort + index-sort)
    index.ts             — Sort module entry point
  merge/
    merge-engines.ts     — MergeEngines unified facade
    index.ts             — Merge module entry point
  index.ts               — Root barrel export
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
