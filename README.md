<p align="center">
  <img src="./illustration.png" alt="electron-modular illustration" width="640" />
</p>

[![codecov](https://codecov.io/gh/trae-op/mega-collection/graph/badge.svg?token=MZHSKKPV79)](https://codecov.io/gh/trae-op/mega-collection) [![TypeScript](https://img.shields.io/badge/TypeScript-%233178C6.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

# @devisfuture/mega-collection

> Search, filter & sort engine for **100K+** item collections in JavaScript / TypeScript.

What does this package solve?

Sometimes in projects, you need to iterate through huge collections (20,000, 40,000, 80,000 elements in an array) that have come from the server. Usually, the most common features are searching, filtering, and sorting.
So, this package helps to perform searching, filtering, and sorting of large collections faster than standard JavaScript methods. This operation is performed before rendering the UI content.

Zero dependencies. Tree-shakeable. Import only what you need.

Each engine lives in its own entry point (`/search`, `/filter`, `/sort`).
Importing just `@devisfuture/mega-collection/search` or the other sub-modules means
only that code ends up in your bundle — unused engines stay out. For example, if
you only pull in `TextSearchEngine` the filter and sort logic won’t be included.

## Features

| Capability                 | Strategy                               | Complexity                         |
| -------------------------- | -------------------------------------- | ---------------------------------- |
| **Indexed filter**         | Hash-Map index (`Map<value, T[]>`)     | **O(1)**                           |
| **Multi-value filter**     | Index intersection + `Set` membership  | **O(k)** indexed / **O(n)** linear |
| **Text search** (contains) | Trigram inverted index + verify        | **O(candidates)**                  |
| **Sorting**                | Pre-sorted index (cached) / V8 TimSort | **O(n)** cached / **O(n log n)**   |

## React demo

A small [repository](https://github.com/trae-op/quick-start_react_mega-collection) demonstrates using `@devisfuture/mega-collection` in a React project.
The example shows search, filter, sort and merge all modules setups with a minimal UI.

A live build of the React app is available at [demo](https://trae-op.github.io/quick-start_react_mega-collection/), showcasing how the package works in a real application.

## Install

```bash
npm install @devisfuture/mega-collection
```

_This package is framework-agnostic and works in all popular front‑end frameworks including React, Angular, Vue and so on._

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

const engine = new TextSearchEngine<User>({
  data: users,
  fields: ["name", "city"],
  minQueryLength: 2,
});

engine.search("john"); // searches all indexed fields, deduplicated
engine.search("name", "john"); // searches a specific field
```

### Filter only

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const engine = new FilterEngine<User>({
  data: users,
  fields: ["city", "age"],
  filterByPreviousResult: true,
});

engine.filter([
  { field: "city", values: ["Kyiv", "Lviv"] },
  { field: "age", values: [25, 30, 35] },
]);

// Sequential mode example:
// 1) First call filters by city
const byCity = engine.filter([{ field: "city", values: ["Dnipro"] }]);
// 2) Second call filters only inside previous result
const byCityAndAge = engine.filter([{ field: "age", values: [22] }]);
```

### Sort only

```ts
import { SortEngine } from "@devisfuture/mega-collection/sort";

const engine = new SortEngine<User>({
  data: users,
  fields: ["age", "name", "city"],
});

// Single-field sort — O(n) via cached index
engine.sort([{ field: "age", direction: "asc" }]);

// Multi-field sort — O(n log n)
engine.sort([
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

| Method                              | Description                     |
| ----------------------------------- | ------------------------------- |
| `search(query)`                     | Search all indexed fields       |
| `search(field, query)`              | Search a specific field         |
| `sort(descriptors)`                 | Sort using stored dataset       |
| `sort(data, descriptors, inPlace?)` | Sort with an explicit dataset   |
| `filter(criteria)`                  | Filter using stored dataset     |
| `filter(data, criteria)`            | Filter with an explicit dataset |

---

### `TextSearchEngine<T>` (search module)

Trigram-based text search engine.

| Method                 | Description                             |
| ---------------------- | --------------------------------------- |
| `search(query)`        | Search all indexed fields, deduplicated |
| `search(field, query)` | Search a specific indexed field         |
| `clear()`              | Free memory                             |

### `FilterEngine<T>` (filter module)

Multi-criteria AND filter with index-accelerated fast path.

Constructor option highlights:

| Option                   | Type      | Description                                                                                                                               |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `filterByPreviousResult` | `boolean` | When `true`, each `filter(criteria)` call filters from previous result. Defaults to `false` (each call starts from the original dataset). |

| Method                   | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `filter(criteria)`       | Filter using stored dataset                          |
| `filter(data, criteria)` | Filter with an explicit dataset                      |
| `resetFilterState()`     | Reset previous-result state for sequential filtering |
| `clearIndexes()`         | Free all index memory                                |

### `SortEngine<T>` (sort module)

Sorting with pre-compiled comparators and cached sort indexes.

| Method                              | Description                   |
| ----------------------------------- | ----------------------------- |
| `sort(descriptors)`                 | Sort using stored dataset     |
| `sort(data, descriptors, inPlace?)` | Sort with an explicit dataset |
| `clearIndexes()`                    | Free all cached indexes       |

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
npm run build          # Build ESM + declarations
npm run typecheck      # Type-check without emitting
npm run dev            # Watch mode
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for our security policy.

## License

MIT — see [LICENSE](LICENSE) for details.
