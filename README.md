<p align="center">
  <img src="./illustration.png" alt="mega-collection illustration" width="100%" />
</p>

[![npm version](https://img.shields.io/npm/v/@devisfuture/mega-collection.svg)](https://www.npmjs.com/package/@devisfuture/mega-collection) [![Downloads](https://img.shields.io/npm/dt/@devisfuture/mega-collection.svg)](https://www.npmjs.com/package/@devisfuture/mega-collection) [![Coverage](https://img.shields.io/codecov/c/github/trae-op/mega-collection/main)](https://codecov.io/gh/trae-op/mega-collection) [![TypeScript](https://img.shields.io/badge/TypeScript-%233178C6.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![GitHub Stars](https://img.shields.io/github/stars/trae-op/mega-collection?style=social)](https://github.com/trae-op/mega-collection)

If this package saved you some time, a ⭐ on GitHub would be much appreciated.

## Table of Contents

- [What does this package solve](#what-does-this-package-solve) – what problem this package helps with
- [Features](#features) – what the package can do
- [React demo](#react-demo) – example project and live demo
- [Install](#install) – how to install the package
- [Quick Start](#quick-start) – basic usage examples
  - [All-in-one: `MergeEngines`](#all-in-one-mergeengines) – use search, filter, and sort from one engine
  - [Search only](#search-only) – use only text search
    - [Flat collections search](#flat-collections-search) – search simple fields like `name` or `city`
    - [Nested collections search](#nested-collections-search) – search inside nested arrays like `orders.status`
  - [Filter only](#filter-only) – use only filtering
    - [Flat collections filter](#flat-collections-filter) – filter by simple top-level fields
    - [Exclude items with `exclude`](#exclude-items-with-exclude) – remove matching items from the result
    - [Nested collections filter](#nested-collections-filter) – filter by nested array fields
  - [Sort only](#sort-only) – use only sorting
- [API Reference](#api-reference) – list of options and methods
  - [`MergeEngines<T>`](#mergeenginest-root-module) – one engine that combines everything
  - [`TextSearchEngine<T>`](#textsearchenginet-search-module) – engine for text search
  - [`FilterEngine<T>`](#filterenginet-filter-module) – engine for filtering
  - [`SortEngine<T>`](#sortenginet-sort-module) – engine for sorting
- [Types](#types) – TypeScript types you can import
- [Build](#build) – commands for build and development
- [Contributing](#contributing) – contribution rules
- [Security](#security) – security policy
- [License](#license) – license information

## What does this package solve

Sometimes in projects, you need to iterate through huge collections (100K+ elements in an array) that have come from the server. Usually, the most common features are searching, filtering, and sorting.
This package helps you search, filter, and sort large collections faster than plain JavaScript methods. Usually you do this before showing data in the UI.

Zero dependencies. Tree-shakeable. Import only what you need.

Each engine lives in its own entry point (`/search`, `/filter`, `/sort`).
Importing just `@devisfuture/mega-collection/search` or the other sub-modules means
only that code goes into your bundle. Unused engines stay out. For example, if
you only import `TextSearchEngine`, the filter and sort code will not be included.

## Features

| Capability                   | Strategy                               | Complexity                         |
| ---------------------------- | -------------------------------------- | ---------------------------------- |
| **Indexed filter**           | Hash-Map index (`Map<value, T[]>`)     | **O(1)**                           |
| **Multi-value filter**       | Index intersection + `Set` membership  | **O(k)** indexed / **O(n)** linear |
| **Nested collection filter** | Pre-built nested index + `Set` lookup  | **O(k)** indexed / **O(n)** linear |
| **Text search** (contains)   | Trigram inverted index + verify        | **O(candidates)**                  |
| **Nested collection search** | Nested trigram index + verify          | **O(candidates)**                  |
| **Sorting**                  | Pre-sorted index (cached) / V8 TimSort | **O(n)** cached / **O(n log n)**   |

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

interface Order {
  id: string;
  status: string;
}

interface UserWithOrders extends User {
  orders: Order[];
}
```

### All-in-one: `MergeEngines`

Use `MergeEngines` when you want one engine that works with the same dataset.
Add the engines you need in `imports`. Only those engines will be created.

You can create many engine instances in one project for different collections.
Each instance keeps its own data and its own indexes, so they work separately
and do not overwrite each other.

Each engine accepts an optional `fields` array (set via the `search`,
`filter` or `sort` option) which tells it which properties should use indexed
execution. Those indexes are built lazily on the first matching operation, so
initial engine creation stays fast even for very large collections. If you skip
`fields`, everything still works, but the engine may need to scan the full
array.

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

const mutableMerge = new MergeEngines<User>({
  imports: [FilterEngine],
  data: users,
  filter: { fields: ["id", "city"], mutableExcludeField: "id" },
});

// dataset is passed once at init — no need to repeat it in every call
engine
  .search("john")
  .sort([{ field: "age", direction: "asc" }])
  .filter([{ field: "city", values: ["Miami", "New York"] }]);

// with nested collection fields (e.g. orders inside each user)
const nestedEngine = new MergeEngines<UserWithOrders>({
  imports: [TextSearchEngine, SortEngine, FilterEngine],
  data: usersWithOrders,
  search: {
    fields: ["name", "city"],
    nestedFields: ["orders.status"],
    minQueryLength: 2,
  },
  filter: {
    fields: ["city", "age"],
    nestedFields: ["orders.status"],
    filterByPreviousResult: true,
  },
  sort: { fields: ["age", "name", "city"] },
});

nestedEngine.search("pending"); // finds users whose orders contain "pending"
nestedEngine.filter([{ field: "orders.status", values: ["delivered"] }]);

// update dataset later without creating a new instance
engine.data([
  {
    id: 1,
    name: "Tim",
    city: "New-York",
    age: 30,
  },
]);

// clear indexes/data for one module
engine.clearIndexes("search").clearIndexes("sort").clearIndexes("filter");
engine.clearData("search").clearData("sort").clearData("filter");

// get shared original dataset
engine.getOriginData();

// fast delete-like exclusion through the root facade
mutableMerge.filter([{ field: "id", exclude: [1, 4] }]);
```

---

### Search only

Use `TextSearchEngine` when you only need text search.
The examples below show the difference between simple fields and nested fields.

#### Flat collections search

```ts
import { TextSearchEngine } from "@devisfuture/mega-collection/search";

// `fields` tells the engine which fields should use indexed search.
// The index is built lazily on first use. If you skip `fields`, search still
// works, but it will scan the full dataset.
const engine = new TextSearchEngine<User>({
  data: users,
  fields: ["name", "city"],
  minQueryLength: 2, // begins searching when query length >= 2
});

// If the query is shorter than `minQueryLength`, the engine returns the
// original dataset. Empty or blank queries also return the original dataset.

engine.search("john"); // searches all indexed fields, deduplicated
engine.search("name", "john"); // searches a specific field

// replace dataset without re-initializing
engine.data(users);

// access original dataset stored in the engine
engine.getOriginData();

// service methods stay on the engine instance
engine.clearIndexes();
engine.clearData();
```

#### Nested collections search

```ts
import { TextSearchEngine } from "@devisfuture/mega-collection/search";

// Search inside nested arrays. `nestedFields` uses dot notation.
const nestedSearch = new TextSearchEngine<UserWithOrders>({
  data: usersWithOrders,
  fields: ["name", "city"],
  nestedFields: ["orders.status"],
  minQueryLength: 2,
});

nestedSearch.search("pending"); // finds users whose orders match
nestedSearch.search("orders.status", "delivered"); // search a specific nested field
```

### Filter only

Use `FilterEngine` when you only need filtering.
The examples below show the difference between simple fields and nested fields.

#### Flat collections filter

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

// `fields` tells the engine which fields should use indexed filter lookups.
// The index is built lazily on first use. Without `fields`, filtering still
// works, but it will scan the data.
const engine = new FilterEngine<User>({
  data: users,
  fields: ["city", "age"],
  filterByPreviousResult: true,
});

engine.filter([
  { field: "city", values: ["Miami", "New York"] },
  { field: "age", values: [25, 30, 35] },
]);

// replace dataset without re-initializing
engine.data(users);

// access original dataset stored in the engine
engine.getOriginData();

engine
  .filter([{ field: "city", values: ["Miami", "New York"] }])
  .filter([{ field: "age", values: [25, 30, 35] }])
  .clearIndexes()
  .resetFilterState()
  .clearData();

// Sequential mode example:
// 1) First call filters by city
const byCity = engine.filter([{ field: "city", values: ["Miami"] }]);
// 2) Second call filters only inside the previous result
const byCityAndAge = engine.filter([{ field: "age", values: [22] }]);
```

#### Exclude items with `exclude`

Use `exclude` when you need to remove items from the result by exact field values.
This is useful for large collections when you already know which ids or field values
must be omitted from the final array.

`exclude` filters the returned result and does not mutate the stored dataset inside the engine.

If the engine already stores the full dataset, `exclude` alone is enough. For example,
`engine.filter([{ field: "id", exclude: [1, 4] }])` returns all stored users except ids `1` and `4`.

This path does not use swap-pop on the stored dataset. `filter(...)` returns a new array,
so the engine still needs one pass over the current source data to build the remaining result.
With an indexed `id` field, the engine avoids repeated full scans per excluded id, but the final
exclude-only operation is still proportional to the current result size.

If you need repeated delete-like exclusions without O(n) per operation, enable mutable exclude mode.
In that mode the engine treats `exclude` on one configured field as in-place removal from the stored
dataset via swap-pop. Order is not preserved.

If the field is listed in `fields`, the engine uses indexed lookups for the exclusion
set instead of scanning the full dataset for every removed value.

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const engine = new FilterEngine<User>({
  data: users,
  fields: ["id", "city"],
});

// Remove users with ids 1 and 3 from the result
engine.filter([{ field: "id", exclude: [1, 3] }]);

// Combine regular filtering with exclusion
engine.filter([
  { field: "city", values: ["Miami", "New York"] },
  { field: "id", exclude: [1, 3] },
]);

const mutableEngine = new FilterEngine<User>({
  data: users,
  fields: ["id", "city"],
  mutableExcludeField: "id",
});

// Fast delete-like exclusion via swap-pop on the stored dataset.
mutableEngine.filter([{ field: "id", exclude: [1, 4] }]);
```

#### Nested collections filter

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

// Filter inside nested arrays. `nestedFields` uses dot notation.
const nestedFilter = new FilterEngine<UserWithOrders>({
  data: usersWithOrders,
  fields: ["city", "age"],
  nestedFields: ["orders.status"],
  filterByPreviousResult: true,
});

nestedFilter.filter([{ field: "orders.status", values: ["pending"] }]);
nestedFilter.filter([
  { field: "orders.status", values: ["pending"] },
  { field: "city", values: ["New-York"] },
]);
```

### Sort only

Use `SortEngine` when you only need sorting.

```ts
import { SortEngine } from "@devisfuture/mega-collection/sort";

// `fields` tells the engine which fields should use cached single-field
// sorting. The cache is built lazily on first use. If you skip `fields`,
// sorting still works.
const engine = new SortEngine<User>({
  data: users,
  fields: ["age", "name", "city"],
});

// Single-field sort
engine.sort([{ field: "age", direction: "asc" }]);

// replace dataset without re-initializing
engine.data(users);

// access original dataset stored in the engine
engine.getOriginData();

// service methods stay on the engine instance
engine.clearIndexes();
engine.clearData();

// Multi-field sort
engine.sort([
  { field: "age", direction: "asc" },
  { field: "name", direction: "desc" },
]);
```

---

## API Reference

### `MergeEngines<T>` (root module)

One engine that brings search, filter, and sort together on the same dataset.

**Constructor options:**

| Option    | Type                                                                       | Description                                  |
| --------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| `imports` | `(typeof TextSearchEngine \| SortEngine \| FilterEngine)[]`                | Engine classes to activate                   |
| `data`    | `T[]`                                                                      | Shared dataset — passed once at construction |
| `search`  | `{ fields, nestedFields?, minQueryLength? }`                               | Config for TextSearchEngine                  |
| `filter`  | `{ fields, nestedFields?, filterByPreviousResult?, mutableExcludeField? }` | Config for FilterEngine                      |
| `sort`    | `{ fields }`                                                               | Config for SortEngine                        |

**Methods:**

| Method                              | Description                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `search(query)`                     | Search all indexed fields                                                                                                  |
| `search(field, query)`              | Search a specific field                                                                                                    |
| `sort(descriptors)`                 | Sort using stored dataset                                                                                                  |
| `sort(data, descriptors, inPlace?)` | Sort with an explicit dataset                                                                                              |
| `filter(criteria)`                  | Filter using stored dataset                                                                                                |
| `filter(data, criteria)`            | Filter with an explicit dataset                                                                                            |
| `getOriginData()`                   | Get the shared original dataset                                                                                            |
| `data(data)`                        | Replace stored dataset for all imported modules, rebuilding configured indexes and resetting filter state where applicable |
| `clearIndexes(module)`              | Clear indexes for one module (`"search"`, `"sort"`, `"filter"`)                                                            |
| `clearData(module)`                 | Clear stored data for one module (`"search"`, `"sort"`, `"filter"`)                                                        |

If `filter.mutableExcludeField` is configured, `filter([{ field, exclude }])` on that field performs fast delete-like exclusion on the stored filter dataset via swap-pop. This mutates the stored filter dataset and does not preserve order.

---

### `TextSearchEngine<T>` (search module)

Text search engine. It supports `nestedFields` if you need to search inside
nested collections such as `["orders.status"]`. Search methods return plain
arrays.

| Method                 | Description                                                |
| ---------------------- | ---------------------------------------------------------- |
| `search(query)`        | Search all indexed fields (including nested), deduplicated |
| `search(field, query)` | Search a specific indexed field or nested field path       |
| `getOriginData()`      | Get the original stored dataset                            |
| `data(data)`           | Replace stored dataset and rebuild configured indexes      |
| `clearIndexes()`       | Clear n-gram indexes (including nested)                    |
| `clearData()`          | Clear stored data                                          |

### `FilterEngine<T>` (filter module)

Filter engine for one or more rules. It supports `nestedFields` if you need to
filter by values inside nested collections such as `["orders.status"]`.
Each criterion can use `values`, `exclude`, or both in the same rule.

Constructor option highlights:

| Option                   | Type       | Description                                                                                                                             |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `filterByPreviousResult` | `boolean`  | When `true`, the next `filter(criteria)` call works on the previous result. By default each call starts from the original dataset.      |
| `mutableExcludeField`    | `string`   | Optional field for fast delete-like `exclude` on stored data via swap-pop. This mutates the stored dataset and does not preserve order. |
| `nestedFields`           | `string[]` | Nested field paths in dot notation, for example `["orders.status"]`.                                                                    |

| Method                   | Description                                                                |
| ------------------------ | -------------------------------------------------------------------------- |
| `filter(criteria)`       | Filter using stored dataset (supports nested field criteria)               |
| `filter(data, criteria)` | Filter with an explicit dataset                                            |
| `getOriginData()`        | Get the original stored dataset                                            |
| `data(data)`             | Replace stored dataset, rebuild configured indexes, and reset filter state |
| `resetFilterState()`     | Reset previous-result state for sequential filtering                       |
| `clearIndexes()`         | Free all index memory (including nested indexes)                           |
| `clearData()`            | Clear stored data                                                          |

### `SortEngine<T>` (sort module)

Sort engine with prepared indexes for faster sorting in common cases. Sort
methods return plain arrays.

| Method                              | Description                                           |
| ----------------------------------- | ----------------------------------------------------- |
| `sort(descriptors)`                 | Sort using stored dataset                             |
| `sort(data, descriptors, inPlace?)` | Sort with an explicit dataset                         |
| `getOriginData()`                   | Get the original stored dataset                       |
| `data(data)`                        | Replace stored dataset and rebuild configured indexes |
| `clearIndexes()`                    | Free all cached indexes                               |
| `clearData()`                       | Clear stored data                                     |

---

**Note on `data` method:** Calling `data` updates the stored dataset. It also rebuilds configured indexes and resets internal state when needed, so you usually do not need to call `clearIndexes` before it.

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
