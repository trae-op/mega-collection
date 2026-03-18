<p align="center">
  <img src="./illustration.png" alt="mega-collection illustration" width="100%" />
</p>

[![npm version](https://img.shields.io/npm/v/@devisfuture/mega-collection.svg)](https://www.npmjs.com/package/@devisfuture/mega-collection) [![Downloads](https://img.shields.io/npm/dt/@devisfuture/mega-collection.svg)](https://www.npmjs.com/package/@devisfuture/mega-collection) [![Coverage](https://img.shields.io/codecov/c/github/trae-op/mega-collection/main)](https://codecov.io/gh/trae-op/mega-collection) [![TypeScript](https://img.shields.io/badge/TypeScript-%233178C6.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![GitHub Stars](https://img.shields.io/github/stars/trae-op/mega-collection?style=social)](https://github.com/trae-op/mega-collection)

If this package saved you some time, a ⭐ on GitHub would be much appreciated.

## Table of Contents

- [What does this package solve](#what-does-this-package-solve) – what problem this package helps with
- [How it works](#how-it-works) – plain-English explanation of how each engine works internally
- [Benchmarks](#benchmarks) – performance numbers and how to run them
- [React demo](#react-demo) – example project and live demo
- [Install](#install) – how to install the package
- [Quick Start](#quick-start) – basic usage examples
  - [All-in-one: `MergeEngines`](#all-in-one-mergeengines) – use search, filter, and sort from one engine
  - [Add items with `add([])`](#add-items-with-add) – append multiple items to stored data
  - [Update items with `update(...)`](#update-items-with-update) – replace one stored item by unique field
  - [Search only](#search-only) – use only text search
    - [Flat collections search](#flat-collections-search) – search simple fields like `name` or `city`
    - [Nested collections search](#nested-collections-search) – search inside nested arrays like `orders.status`
  - [Filter only](#filter-only) – use only filtering
    - [Flat collections filter](#flat-collections-filter) – filter by simple top-level fields
    - [Exclude items with `exclude`](#exclude-items-with-exclude) – remove matching items from the result
      - [Result-only exclude](#result-only-exclude) – return a filtered result without mutating stored data
      - [Mutable exclude with `mutableExcludeField`](#mutable-exclude-with-mutableexcludefield) – fast delete-like removal via swap-pop
    - [Nested collections filter](#nested-collections-filter) – filter by nested array fields
  - [Sort only](#sort-only) – use only sorting
- [API Reference](#api-reference) – list of options and methods
  - [`MergeEngines<T>`](#mergeenginest-root-module) – one engine that combines everything
  - [`TextSearchEngine<T>`](#textsearchenginet-search-module) – engine for text search
  - [`FilterEngine<T>`](#filterenginet-filter-module) – engine for filtering
  - [`SortEngine<T>`](#sortenginet-sort-module) – engine for sorting
- [Contributing](#contributing) – contribution rules
- [Security](#security) – security policy
- [License](#license) – license information

## What does this package solve

When your API returns thousands of items, you usually need to let the user search, filter, or sort them on the client side.

The typical way to do this is with built-in array methods:

```ts
const results = users.filter((u) => u.city === "New York");
const sorted = [...users].sort((a, b) => a.age - b.age);
const found = users.filter((u) => u.name.toLowerCase().includes(query));
```

This works fine for small arrays. But with 10 000–100 000+ items, every call to `filter` or `sort` scans the whole array from scratch. If you run it on every keystroke, it adds up.

This package solves this by building indexes ahead of time — special data structures that let you look up results without scanning the full array every time. You pay the cost once when the data arrives, and then each search, filter, or sort is much cheaper.

### Important

The package has no dependencies. You can import only the parts you need.
Each engine has its own entry point: `/search`, `/filter`, `/sort`.
If you import only `@devisfuture/mega-collection/search`, only search code goes into the bundle.
Unused modules are not included.

## How it works

### Search

Native `Array.prototype.filter` with `String.includes` checks every item in the array on each keystroke. For 50 000 items that's 50 000 string comparisons per call.

`TextSearchEngine` avoids this by building an **n-gram inverted index** upfront:

1. Each string value is split into overlapping 2- and 3-character pieces called n-grams. For example, `"hello"` produces `"he"`, `"hel"`, `"el"`, `"ell"`, `"ll"`, `"llo"`, `"lo"`.
2. For every n-gram the engine keeps a set of item positions that contain it.
3. When you search for `"john"`, the engine splits that query into the same n-gram pieces, then intersects the sets — only items that share all query n-grams survive. This candidate set is usually tiny even for 100 000 items.
4. Each surviving candidate is checked with a fast `String.includes` to confirm the full substring match.

For very short queries (fewer than 2 characters) the engine falls back to a linear scan — n-grams that short would match too many items to be useful.

### Filter

Native `Array.prototype.filter` with `===` still checks every item on every call.

`FilterEngine` builds a **hash-map** for each indexed field:

```
field "city" → { "New York": [item0, item4, ...], "Miami": [item1, ...], ... }
```

A filter call becomes a map lookup: `index.get("New York")` returns the array of matches in O(1). Multiple values from the same field are concatenated. Multiple fields are intersected using a `Set`.

When the `fields` option is not provided, the engine falls back to a linear scan — which works but is slower.

### Sort

Native `Array.prototype.sort` re-sorts the whole array from scratch every call.

`SortEngine` pre-sorts and stores results in a `Uint32Array` of positions:

```
cache["age"] = [index of youngest item, index of next, ..., index of oldest]
```

The first sort call builds this index. Subsequent calls just read it in O(n). The cache is invalidated on mutations and rebuilt lazily on the next sort call.

---

## Benchmarks

Benchmarks for `TextSearchEngine`, `FilterEngine`, and `SortEngine` are collected in [BENCHMARKS](./BENCHMARKS.md).

## React demo

A small [repository](https://github.com/trae-op/quick-start_react_mega-collection) shows how to use `@devisfuture/mega-collection` in React.
It has examples for search, filter, sort, and `MergeEngines` with a simple UI.

There is also a live [demo](https://trae-op.github.io/quick-start_react_mega-collection/).

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

Use `MergeEngines` when you want one class that works with one dataset.
Add needed engines to `imports`. Only those engines will be created.

You can create many engine instances in one project for different collections.
Each instance keeps its own dataset and runtime indexes inside an internal shared `State`, so separate instances do not affect each other.

Each engine can receive an optional `fields` array through `search`, `filter`, or `sort` options.
These fields are used for indexes.

Indexes are built lazily on first use inside that shared state, so engine creation stays fast.
If you skip `fields`, everything still works, but the engine may scan the full array.

```ts
import { MergeEngines } from "@devisfuture/mega-collection";
import { TextSearchEngine } from "@devisfuture/mega-collection/search";
import { SortEngine } from "@devisfuture/mega-collection/sort";
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const engine = new MergeEngines<User>({
  imports: [TextSearchEngine, SortEngine, FilterEngine],
  data: users,
  filterByPreviousResult: true,
  search: { fields: ["name", "city"], minQueryLength: 2 },
  filter: { fields: ["city", "age"] },
  sort: { fields: ["age", "name", "city"] },
});

const mutableMerge = new MergeEngines<User>({
  imports: [FilterEngine],
  data: users,
  filter: { fields: ["id", "city"], mutableExcludeField: "id" },
});

// Dataset is passed once in the constructor.
engine
  .search("john")
  .sort([{ field: "age", direction: "asc" }])
  .filter([{ field: "city", values: ["Miami", "New York"] }]);

// Separate calls also continue from the last result when
// `filterByPreviousResult` is enabled on MergeEngines.
const searchResult = engine.search("john");
const filteredResult = engine.filter([
  { field: "city", values: ["Miami", "New York"] },
]);
const sortedResult = engine.sort([{ field: "age", direction: "asc" }]);

// Example with nested fields, for example `orders` inside each user.
const nestedEngine = new MergeEngines<UserWithOrders>({
  imports: [TextSearchEngine, SortEngine, FilterEngine],
  data: usersWithOrders,
  filterByPreviousResult: true,
  search: {
    fields: ["name", "city"],
    nestedFields: ["orders.status"],
    minQueryLength: 2,
  },
  filter: {
    fields: ["city", "age"],
    nestedFields: ["orders.status"],
  },
  sort: { fields: ["age", "name", "city"] },
});

nestedEngine.search("pending"); // finds users whose orders contain "pending"
nestedEngine.filter([{ field: "orders.status", values: ["delivered"] }]);

// Replace dataset later without creating a new instance.
engine.data([
  {
    id: 1,
    name: "Tim",
    city: "New-York",
    age: 30,
  },
]);

// Clear indexes or data for one module.
engine.clearIndexes("search").clearIndexes("sort").clearIndexes("filter");
engine.clearData("search").clearData("sort").clearData("filter");

// Get shared original dataset.
engine.getOriginData();

// Remove items through the root facade.
mutableMerge.filter([{ field: "id", exclude: [1, 4] }]);
```

---

### Add items with `add([])`

Use `add([])` when you need to append several new items to the stored dataset.
This is different from `data(...)`:

- `data(...)` replaces the whole stored dataset.
- `add([])` appends new items to the existing stored dataset.

If indexes are already built, `add()` updates them incrementally for the new items only:

- **TextSearchEngine / FilterEngine**: O(k) — only the new items are written into the n-gram or hash-map index (existing index entries are untouched).
- **SortEngine**: the sort cache for each configured field is invalidated on `add()` and rebuilt lazily on the next `sort()` call. This avoids O(N) work per add and is optimal when multiple adds happen between sorts.

If indexes have not been built yet (first `sort()` has not been called), `add()` appends the items without touching any index.
If you cleared indexes with `clearIndexes()`, `add([])` does not rebuild them automatically.

```ts
import { MergeEngines } from "@devisfuture/mega-collection";
import { TextSearchEngine } from "@devisfuture/mega-collection/search";
import { SortEngine } from "@devisfuture/mega-collection/sort";
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const merge = new MergeEngines<User>({
  imports: [TextSearchEngine, SortEngine, FilterEngine],
  data: users,
  search: { fields: ["name", "city"], minQueryLength: 2 },
  filter: { fields: ["city", "age"] },
  sort: { fields: ["age", "name"] },
});

merge.add([
  { id: 6, name: "Lia", city: "Berlin", age: 28 },
  { id: 7, name: "Omar", city: "Kyiv", age: 31 },
]);

merge.search("Berlin");
merge.filter([{ field: "city", values: ["Kyiv"] }]);
merge.sort([{ field: "age", direction: "asc" }]);
```

The same method works in each engine:

```ts
import { TextSearchEngine } from "@devisfuture/mega-collection/search";
import { FilterEngine } from "@devisfuture/mega-collection/filter";
import { SortEngine } from "@devisfuture/mega-collection/sort";

const searchEngine = new TextSearchEngine<User>({
  data: users,
  fields: ["name", "city"],
});

searchEngine.add([
  { id: 6, name: "Lia", city: "Berlin", age: 28 },
  { id: 7, name: "Omar", city: "Kyiv", age: 31 },
]);

const filterEngine = new FilterEngine<User>({
  data: users,
  fields: ["city", "age"],
});

filterEngine.add([
  { id: 6, name: "Lia", city: "Berlin", age: 28 },
  { id: 7, name: "Omar", city: "Kyiv", age: 31 },
]);

const sortEngine = new SortEngine<User>({
  data: users,
  fields: ["age", "name"],
});

sortEngine.add([
  { id: 6, name: "Lia", city: "Berlin", age: 28 },
  { id: 7, name: "Omar", city: "Kyiv", age: 31 },
]);
```

---

### Update items with `update(...)`

Use `update(...)` when you need to replace one stored item by a unique field such as `id`.

- `update(...)` keeps the same stored array reference.
- `update(...)` replaces only the matched item in stored data.
- configured indexes or caches refresh only the affected item instead of rebuilding the whole dataset.

```ts
import { MergeEngines } from "@devisfuture/mega-collection";
import { TextSearchEngine } from "@devisfuture/mega-collection/search";
import { SortEngine } from "@devisfuture/mega-collection/sort";
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const merge = new MergeEngines<User>({
  imports: [TextSearchEngine, SortEngine, FilterEngine],
  data: users,
  search: { fields: ["name", "city"], minQueryLength: 2 },
  filter: { fields: ["city", "age"] },
  sort: { fields: ["age", "name"] },
});

merge.update({
  field: "id",
  data: { id: 2, name: "Bob", city: "Paris", age: 19 },
});

merge.search("Paris");
merge.filter([{ field: "city", values: ["Paris"] }]);
merge.sort([{ field: "age", direction: "asc" }]);
```

The same method works in each engine:

```ts
import { TextSearchEngine } from "@devisfuture/mega-collection/search";

const searchEngine = new TextSearchEngine<User>({
  data: users,
  fields: ["name", "city"],
});

searchEngine.update({
  field: "id",
  data: { id: 2, name: "Bob", city: "Paris", age: 19 },
});
```

---

### Search only

Use `TextSearchEngine` when you only need text search.
The examples below show search by simple fields and nested fields.

#### Flat collections search

```ts
import { TextSearchEngine } from "@devisfuture/mega-collection/search";

// `fields` tells the engine which fields should use indexed search.
// The index is built only when it is needed for the first time.
// If you skip `fields`, search still works, but it scans the full dataset.
const engine = new TextSearchEngine<User>({
  data: users,
  fields: ["name", "city"],
  minQueryLength: 2, // begins searching when query length >= 2
});

// If the query is shorter than `minQueryLength`, the engine returns
// the original dataset. Empty or blank queries do the same.

engine.search("john"); // searches all indexed fields, deduplicated
engine.search("name", "john"); // searches a specific field
engine.search("john", { limit: 20, offset: 20 }); // paginate broad result sets

// replace dataset without re-initializing
engine.data(users);

// replace one stored item by unique field
engine.update({
  field: "id",
  data: { id: 2, name: "Bob", city: "Paris", age: 19 },
});

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
The examples below show filtering by simple fields and nested fields.

#### Flat collections filter

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

// `fields` tells the engine which fields should use indexes for filtering.
// The index is built only when it is needed for the first time.
// Without `fields`, filtering still works, but it scans the data.
const engine = new FilterEngine<User>({
  data: users,
  fields: ["city", "age"],
  filterByPreviousResult: true,
});

engine.filter([
  { field: "city", values: ["Miami", "New York"] },
  { field: "age", values: [25, 30, 35] },
]);

// Replace dataset without creating a new engine.
engine.data(users);

// Replace one stored item by unique field.
engine.update({
  field: "id",
  data: { id: 2, name: "Bob", city: "Paris", age: 19, active: true },
});

// Get original stored dataset.
engine.getOriginData();

// Sequential mode example:
// 1) First call filters by city.
const byCity = engine.filter([{ field: "city", values: ["Miami"] }]);
// 2) Second call works only on the previous result.
const byCityAndAge = engine.filter([{ field: "age", values: [22] }]);
// 3) Returning to an earlier criteria state restores its previous result.
const byCityAgain = engine.filter([{ field: "city", values: ["Miami"] }]);
```

#### Exclude items with `exclude`

Use `exclude` when you want to remove items from the result by exact field values.
This is useful when you already know which `id` values or other field values should not be in the result.

`exclude` changes only the returned result. It does not change the stored dataset inside the engine.

There are two ways to work with `exclude`:

- Result-only exclude: returns a filtered array and leaves the stored dataset unchanged.
- Mutable exclude with `mutableExcludeField`: removes items from the stored dataset with **swap-pop**.

**Swap-pop** is an efficient array removal technique where the element to be removed is swapped with the last element in the array, and then the array length is decreased by one. This provides O(1) time complexity for removal but does not preserve the original order of elements.

#### Result-only exclude

If the engine already stores the full dataset, `exclude` alone is enough. For example,
`engine.filter([{ field: "id", exclude: [1, 4] }])` returns all stored users except users with `id` `1` and `4`.

This mode does not use swap-pop on the stored dataset. `filter(...)` returns a new array,
so the engine still needs one pass over the current data to build the result.
If `id` is indexed, the engine does not scan the full dataset again for each excluded `id`,
but it still has to build the final array.

If you need repeated removals from a large collection and do not want O(n) work for each removed item,
use mutable exclude mode.
In this mode the engine removes items from the stored dataset with swap-pop.
Order is not preserved.

If the field is listed in `fields`, the engine uses indexes for exclude values
instead of scanning the full dataset again for every removed value.

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const engine = new FilterEngine<User>({
  data: users,
  fields: ["id", "city"],
});

// Returns all users except users with ids 1 and 3.
const visibleUsers = engine.filter([{ field: "id", exclude: [1, 3] }]);

// You can combine normal filtering and exclude.
engine.filter([
  { field: "city", values: ["Miami", "New York"] },
  { field: "id", exclude: [1, 3] },
]);
```

#### Mutable exclude with `mutableExcludeField`

If you need repeated fast removals from a large stored dataset, use `mutableExcludeField`.
In this mode the engine removes items from the stored dataset with swap-pop.

Use this mode when all of these points are true:

- the engine already stores the full dataset
- the exclude field is unique, for example `id`
- order does not need to be preserved
- you want repeated removals without O(n) per removed id

This mode changes the stored dataset.
After exclusion, `getOriginData()` returns the reduced collection.

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const mutableEngine = new FilterEngine<User>({
  data: users,
  fields: ["id", "city"],
  mutableExcludeField: "id",
});

// Removes items from the stored dataset with swap-pop.
mutableEngine.filter([{ field: "id", exclude: [1, 4] }]);

// The stored dataset is now smaller.
mutableEngine.getOriginData();
```

The same mode also works through `MergeEngines`:

```ts
import { MergeEngines } from "@devisfuture/mega-collection";
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const mutableMerge = new MergeEngines<User>({
  imports: [FilterEngine],
  data: users,
  filter: {
    fields: ["id", "city"],
    mutableExcludeField: "id",
  },
});

mutableMerge.filter([{ field: "id", exclude: [1, 4] }]);
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

// replace one stored item by unique field
engine.update({
  field: "id",
  data: { id: 2, name: "Bob", city: "Paris", age: 19 },
});

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

One class that combines search, filter, and sort for the same dataset.

**Constructor options:**

| Option                   | Type                                                        | Description                                                                                                    |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `imports`                | `(typeof TextSearchEngine \| SortEngine \| FilterEngine)[]` | Engine classes to create                                                                                       |
| `data`                   | `T[]`                                                       | Shared dataset — passed once at construction                                                                   |
| `filterByPreviousResult` | `boolean`                                                   | When `true`, separate `filter(...)` and `sort(...)` calls continue from the last result stored in shared State |
| `search`                 | `{ fields, nestedFields?, minQueryLength? }`                | Config for TextSearchEngine                                                                                    |
| `filter`                 | `{ fields, nestedFields?, mutableExcludeField? }`           | Config for FilterEngine                                                                                        |
| `sort`                   | `{ fields }`                                                | Config for SortEngine                                                                                          |

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
| `add(items)`                        | Append multiple items to the stored dataset and update existing indexes or caches for new items only                       |
| `update({ field, data })`           | Replace one stored item by a unique field and refresh only the affected cached or indexed data                             |
| `data(data)`                        | Replace stored dataset for all imported modules, rebuilding configured indexes and resetting filter state where applicable |
| `clearIndexes(module)`              | Clear indexes for one module (`"search"`, `"sort"`, `"filter"`)                                                            |
| `clearData(module)`                 | Clear the shared stored dataset through one imported module (`"search"`, `"sort"`, `"filter"`)                             |

---

### `TextSearchEngine<T>` (search module)

Text search engine.
It supports `nestedFields` if you need to search inside nested collections such as `["orders.status"]`.
Search methods return plain arrays.

Main constructor options:

| Option                   | Type       | Description                                                                                                                                                                     |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filterByPreviousResult` | `boolean`  | When `true`, a query that narrows the previous one (new query includes old query) searches only the previous result instead of the full dataset. Any mutation resets the state. |
| `nestedFields`           | `string[]` | Nested field paths in dot notation, for example `["orders.status"]`.                                                                                                            |

| Method                           | Description                                                          |
| -------------------------------- | -------------------------------------------------------------------- |
| `search(query, options?)`        | Search all indexed fields (including nested), deduplicated           |
| `search(field, query, options?)` | Search a specific indexed field or nested field path                 |
| `searchAll(query, options?)`     | Explicit all-fields alias when you want pagination on broad searches |
| `resetSearchState()`             | Reset previous-result state for sequential narrowing search          |
| `getOriginData()`                | Get the original stored dataset                                      |
| `add(items)`                     | Append multiple items to the stored dataset                          |
| `update({ field, data })`        | Replace one stored item by a unique field                            |
| `data(data)`                     | Replace stored dataset and rebuild configured indexes                |
| `clearIndexes()`                 | Clear n-gram indexes (including nested)                              |
| `clearData()`                    | Clear stored data                                                    |

`options.limit` and `options.offset` are useful for broad result sets where you only need the current page.

### `FilterEngine<T>` (filter module)

Filter engine for one or more rules.
It supports `nestedFields` if you need to filter by values inside nested collections such as `["orders.status"]`.
Each criterion can use `values`, `exclude`, or both in the same rule.

Main constructor options:

| Option                   | Type       | Description                                                                                                                        |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `filterByPreviousResult` | `boolean`  | When `true`, the next `filter(criteria)` call works on the previous result. By default each call starts from the original dataset. |
| `mutableExcludeField`    | `string`   | Optional field for removing items from stored data with swap-pop. This changes the stored dataset and does not preserve order.     |
| `nestedFields`           | `string[]` | Nested field paths in dot notation, for example `["orders.status"]`.                                                               |

| Method                    | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `filter(criteria)`        | Filter using stored dataset (supports nested field criteria)               |
| `filter(data, criteria)`  | Filter with an explicit dataset                                            |
| `getOriginData()`         | Get the original stored dataset                                            |
| `add(items)`              | Append multiple items to the stored dataset                                |
| `update({ field, data })` | Replace one stored item by a unique field                                  |
| `data(data)`              | Replace stored dataset, rebuild configured indexes, and reset filter state |
| `resetFilterState()`      | Reset previous-result state for sequential filtering                       |
| `clearIndexes()`          | Free all index memory (including nested indexes)                           |
| `clearData()`             | Clear stored data                                                          |

### `SortEngine<T>` (sort module)

Sort engine with prepared indexes for faster sorting in common cases.
Sort methods return plain arrays.

| Method                              | Description                                           |
| ----------------------------------- | ----------------------------------------------------- |
| `sort(descriptors)`                 | Sort using stored dataset                             |
| `sort(data, descriptors, inPlace?)` | Sort with an explicit dataset                         |
| `getOriginData()`                   | Get the original stored dataset                       |
| `add(items)`                        | Append multiple items to the stored dataset           |
| `update({ field, data })`           | Replace one stored item by a unique field             |
| `data(data)`                        | Replace stored dataset and rebuild configured indexes |
| `clearIndexes()`                    | Free all cached indexes                               |
| `clearData()`                       | Clear stored data                                     |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for our security policy.

## License

MIT — see [LICENSE](LICENSE) for details.
