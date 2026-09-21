# mega-collection — Search, filter, and sort arrays of objects

Indexed client-side search, filtering, and sorting for JavaScript and TypeScript collections. Search text across object fields, filter nested arrays or tags, and sort by one or more fields — with zero runtime dependencies.

Use it when your application already has the data in memory and users repeatedly search, filter, or sort it: product catalogs, user directories, admin tables, and searchable lists.

[![npm version](https://img.shields.io/npm/v/@devisfuture/mega-collection.svg)](https://www.npmjs.com/package/@devisfuture/mega-collection) [![Downloads](https://img.shields.io/npm/dt/@devisfuture/mega-collection.svg)](https://www.npmjs.com/package/@devisfuture/mega-collection) [![Coverage](https://img.shields.io/codecov/c/github/trae-op/mega-collection/main)](https://codecov.io/gh/trae-op/mega-collection) [![TypeScript](https://img.shields.io/badge/TypeScript-%233178C6.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![GitHub Stars](https://img.shields.io/github/stars/trae-op/mega-collection?style=social)](https://github.com/trae-op/mega-collection)

[Live React demo](https://trae-op.github.io/quick-start_react_mega-collection/) · [Demo source](https://github.com/trae-op/quick-start_react_mega-collection) · [Benchmarks](https://github.com/trae-op/mega-collection/blob/main/BENCHMARKS.md)

## What does this package solve?

A search input, a few filters, and sortable columns often lead to repeated array scans and sorting:

```ts
const found = users.filter((user) =>
  user.name.toLowerCase().includes(query.toLowerCase()),
);
const filtered = found.filter((user) => user.city === "Kyiv");
const sorted = [...filtered].sort((a, b) => a.age - b.age);
```

Native array methods are a good starting point. As the dataset and number of repeated operations grow, rebuilding the same results can become costly.

`mega-collection` keeps reusable search and filter indexes and sorting caches for a stored collection. Configure the fields once, reuse the engine across interactions, and update its data through the provided methods. Indexes are built on demand; mutations can update indexes or invalidate caches.

Indexing has an initial time and memory cost. The benefit depends on your data, query selectivity, update frequency, and how often you reuse the engine — it is not a promise that every operation is faster.

### Is this the right package for you?

| Your task                                                              | Use                |
| ---------------------------------------------------------------------- | ------------------ |
| Search names, titles, or other text fields by a partial string         | `TextSearchEngine` |
| Filter an array of objects by exact field values                       | `FilterEngine`     |
| Search or filter objects inside nested arrays, such as `orders.status` | `nestedFields`     |
| Search tags or require selected skills in a primitive array            | `arrayFields`      |
| Sort by one or more fields                                             | `SortEngine`       |
| Combine search, filtering, and sorting over one stored dataset         | `MergeEngines`     |

The package is a data-processing library, not a table or search-input component. It works independently of your UI framework, including React, Vue, and Angular. It processes the data you provide; it does not fetch records or replace server-side queries for data that is not loaded.

## Install

```bash
npm install @devisfuture/mega-collection
```

The package provides ESM entry points and TypeScript declarations. Import only the engines you need; separate entry points and `sideEffects: false` support tree shaking in compatible bundlers.

## Quick start

A complete example: search users, keep matches from Kyiv, then sort by age.

```ts
import { MergeEngines } from "@devisfuture/mega-collection";
import { TextSearchEngine } from "@devisfuture/mega-collection/search";
import { FilterEngine } from "@devisfuture/mega-collection/filter";
import { SortEngine } from "@devisfuture/mega-collection/sort";

interface User {
  id: number;
  name: string;
  city: string;
  age: number;
}

const users: User[] = [
  { id: 1, name: "John", city: "Kyiv", age: 32 },
  { id: 2, name: "Johnny", city: "Kyiv", age: 24 },
  { id: 3, name: "Alice", city: "Lviv", age: 28 },
];

const engine = new MergeEngines<User>({
  imports: [TextSearchEngine, FilterEngine, SortEngine],
  data: users,
  search: { fields: ["name"], minQueryLength: 2 },
  filter: { fields: ["city"] },
  sort: { fields: ["age"] },
});

// Explicit intermediate results make each processing step clear.
const found = engine.search("john");
const filtered = engine.filter(found, [{ field: "city", values: ["Kyiv"] }]);
const sorted = engine.sort(filtered, [{ field: "age", direction: "asc" }]);

console.log(sorted.map((user) => user.name));
// ["Johnny", "John"]
```

Create and reuse an engine for a collection instead of rebuilding it for every keystroke. Each engine instance has its own data and runtime state.

## Table of contents

- [Choose an engine](#choose-an-engine)
- [Example data](#example-data)
- [Search arrays of objects](#search-arrays-of-objects)
  - [Search text fields](#search-text-fields)
  - [Search nested arrays](#search-nested-arrays)
  - [Search tags and primitive array fields](#search-tags-and-primitive-array-fields)
- [Filter arrays of objects](#filter-arrays-of-objects)
  - [Filter by multiple fields](#filter-by-multiple-fields)
  - [Exclude items](#exclude-items-with-exclude)
  - [Filter nested arrays](#filter-nested-arrays)
  - [Filter tags and skills](#filter-tags-and-skills)
- [Sort by one or multiple fields](#sort-by-one-or-multiple-fields)
- [Combine search, filter, and sort](#combine-search-filter-and-sort)
- [Update the stored collection](#update-the-stored-collection)
- [How indexing works](#how-indexing-works)
- [Benchmarks and performance](#benchmarks-and-performance)
- [React demo](#react-demo)
- [API reference](#api-reference)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Choose an engine

| Export             | Import path                                                            | Purpose                              |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------ |
| `TextSearchEngine` | `@devisfuture/mega-collection/search`                                  | Case-insensitive substring search    |
| `FilterEngine`     | `@devisfuture/mega-collection/filter`                                  | Exact-value inclusion and exclusion  |
| `SortEngine`       | `@devisfuture/mega-collection/sort`                                    | Single-field and multi-field sorting |
| `MergeEngines`     | `@devisfuture/mega-collection` or `@devisfuture/mega-collection/merge` | Combine engines over shared data     |

Configure scalar fields with `fields`, nested array paths with `nestedFields`, and top-level primitive arrays with `arrayFields`. The latter two options apply to search and filtering.

## Example data

The detailed examples below use this shared fixture unless they define their own data. Run each example independently; mutation examples change the stored collection.

```ts
interface User {
  id: number;
  name: string;
  city: string;
  age: number;
  skills?: (string | number | boolean)[];
  interests?: (string | number | boolean)[];
}

interface Order {
  id: string;
  status: string;
}

interface UserWithOrders extends User {
  orders: Order[];
}

const users: User[] = [
  {
    id: 1,
    name: "John",
    city: "Miami",
    age: 25,
    skills: ["JavaScript", "React"],
    interests: ["sports", "music"],
  },
  {
    id: 2,
    name: "Bob",
    city: "New York",
    age: 30,
    skills: ["TypeScript"],
    interests: ["reading"],
  },
  {
    id: 3,
    name: "Alice",
    city: "Miami",
    age: 22,
    skills: ["JavaScript", "TypeScript"],
    interests: ["music"],
  },
  {
    id: 4,
    name: "Johnny",
    city: "New York",
    age: 35,
    skills: ["React"],
    interests: ["gaming"],
  },
];

const usersWithOrders: UserWithOrders[] = users.map((user) => ({
  ...user,
  orders: [
    { id: `order-${user.id}`, status: user.id % 2 ? "pending" : "delivered" },
  ],
}));
```

## Search arrays of objects

Use `TextSearchEngine` when you only need text search.
Search is case-insensitive substring matching: `john` matches `Johnny`, and `ohn` matches `John`. Use one field or search across configured fields.

### Search text fields

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

// remove one stored item by unique field
engine.delete("id", 2);

// access original dataset stored in the engine
engine.getOriginData();

// service methods stay on the engine instance
engine.clearIndexes();
engine.clearData();
```

### Search nested arrays

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

### Search tags and primitive array fields

Search inside top-level primitive arrays. `arrayFields` accepts field names
directly, not dot-notation paths. Use `nestedFields` for paths such as
`orders.status`.

```ts
import { TextSearchEngine } from "@devisfuture/mega-collection/search";

interface UserWithArrays {
  id: string;
  name: string;
  interests: Array<string | number | boolean>;
  skills?: Array<string | number | boolean>;
}

const usersWithArrays: UserWithArrays[] = [
  {
    id: "1",
    name: "Alice",
    interests: ["sports", "music", 30, false],
    skills: ["JavaScript", "React"],
  },
  {
    id: "2",
    name: "Bob",
    interests: ["reading", "cooking"],
    skills: ["TypeScript"],
  },
];

// `arrayFields` lists which fields are primitive arrays to index.
const arraySearch = new TextSearchEngine<UserWithArrays>({
  data: usersWithArrays,
  fields: ["name"],
  arrayFields: ["interests", "skills"],
});

arraySearch.search("spo"); // searches name, interests, and skills
arraySearch.search("interests", "spo"); // partial match: finds "sports" in Alice's interests
arraySearch.search("30"); // numbers are searchable as text
arraySearch.search("false"); // booleans are searchable as text
```

Invalid or missing array fields do not throw. Unsupported elements such as
`null`, `undefined`, objects, and nested arrays are ignored while valid
`string`, `number`, and `boolean` elements in the same array remain searchable.
After `clearIndexes()`, the engine uses a linear fallback with the same matching
semantics.

## Filter arrays of objects

Use `FilterEngine` when you only need filtering.
For scalar fields, multiple `values` in one criterion are alternatives (OR). Criteria for different fields are combined (AND). For primitive array fields, all selected values must be present (AND).

### Filter by multiple fields

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
  data: { id: 2, name: "Bob", city: "Paris", age: 19 },
});

// Remove stored items by unique field.
engine.delete("id", [1, 4]);

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

### Exclude items with `exclude`

Use `exclude` when you want to remove items from the result by exact field values.
This is useful when you already know which `id` values or other field values should not be in the result.

`exclude` changes only the returned result. It does not change the stored dataset inside the engine.

#### Result-only exclude

If the engine already stores the full dataset, `exclude` alone is enough. For example,
`engine.filter([{ field: "id", exclude: [1, 4] }])` returns all stored users except users with `id` `1` and `4`.

This mode does not use swap-pop on the stored dataset. `filter(...)` returns a new array,
so the engine still needs one pass over the current data to build the result.
If `id` is indexed, the engine does not scan the full dataset again for each excluded `id`,
but it still has to build the final array.

If you need to remove items from the stored dataset itself, use `delete(...)`.
That operation is separate from filtering so result-only `exclude` stays predictable.

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

### Filter nested arrays

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
  { field: "city", values: ["New York"] },
]);
```

### Filter tags and skills

Filter by primitive array fields. Values use **AND** semantics (all selected values must be present). Exclude uses **ANY** semantics (exclude items where the array contains any excluded value).

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

// Uses the UserWithArrays type and usersWithArrays data from the array search example.
const arrayFilter = new FilterEngine<UserWithArrays>({
  data: usersWithArrays,
  arrayFields: ["interests"],
});

// AND: both "sports" AND "music" must be in the interests array
arrayFilter.filter([{ field: "interests", values: ["sports", "music"] }]);

// ANY exclude: exclude items whose interests contain "sports"
arrayFilter.filter([{ field: "interests", exclude: ["sports"] }]);

// Combined: interests must contain "music" AND must NOT contain "gaming"
arrayFilter.filter([
  { field: "interests", values: ["music"], exclude: ["gaming"] },
]);

// Exact matching preserves primitive types: 30 does not match "30".
arrayFilter.filter([{ field: "interests", values: [30] }]);

// An explicit empty values list is unsatisfiable and returns an empty result.
arrayFilter.filter([{ field: "interests", values: [] }]); // []
```

Duplicate selected values do not require duplicate entries in the item array.
For example, `values: ["music", "music"]` behaves like `values: ["music"]`.

When a UI multiselect has no selected values and you want to skip filtering,
omit that criterion instead of passing `values: []`:

```ts
const selectedInterests: string[] = ["music"];

const criteria =
  selectedInterests.length > 0
    ? [{ field: "interests", values: selectedInterests }]
    : [];

arrayFilter.filter(criteria);
```

For inclusion, a missing or invalid array field does not match. For an
exclude-only criterion, an item with a missing or invalid array field remains
in the result because it contains none of the excluded values. After
`clearIndexes()`, the linear fallback preserves the same behavior.

## Sort by one or multiple fields

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

// Multi-field sort
engine.sort([
  { field: "age", direction: "asc" },
  { field: "name", direction: "desc" },
]);

// replace dataset without re-initializing
engine.data(users);

// replace one stored item by unique field
engine.update({
  field: "id",
  data: { id: 2, name: "Bob", city: "Paris", age: 19 },
});

// remove one stored item by unique field
engine.delete("id", 2);

// access original dataset stored in the engine
engine.getOriginData();

// service methods stay on the engine instance
engine.clearIndexes();
engine.clearData();
```

---

## Combine search, filter, and sort

`MergeEngines` creates only the engine classes listed in `imports`. Each instance owns one shared dataset and its runtime indexes; separate instances do not share state.

The quick start passes intermediate arrays explicitly. Alternatively, enable `filterByPreviousResult` so separate filter and sort calls continue from the last shared result:

```ts
import { MergeEngines } from "@devisfuture/mega-collection";
import { TextSearchEngine } from "@devisfuture/mega-collection/search";
import { FilterEngine } from "@devisfuture/mega-collection/filter";
import { SortEngine } from "@devisfuture/mega-collection/sort";

const engine = new MergeEngines<User>({
  imports: [TextSearchEngine, FilterEngine, SortEngine],
  data: users,
  filterByPreviousResult: true,
  search: { fields: ["name", "city"], minQueryLength: 2 },
  filter: { fields: ["city", "age"] },
  sort: { fields: ["age", "name"] },
});

engine.search("john");
engine.filter([{ field: "city", values: ["Miami", "New York"] }]);
const result = engine.sort([{ field: "age", direction: "asc" }]);
```

For nested arrays, add `nestedFields: ["orders.status"]` to the search or filter configuration and use `UserWithOrders` as the item type.

For primitive array fields, configure `arrayFields` on the relevant engines:

```ts
const arrayEngine = new MergeEngines<User>({
  imports: [TextSearchEngine, FilterEngine],
  data: users,
  search: { arrayFields: ["interests", "skills"], minQueryLength: 1 },
  filter: { arrayFields: ["interests", "skills"] },
});

arrayEngine.search("interests", "spo");
arrayEngine.filter([{ field: "skills", values: ["JavaScript", "React"] }]); // Both skills must be present.
```

### Clear indexes or data

```ts
engine.clearIndexes("search");
engine.clearIndexes("sort");
engine.clearIndexes("filter");

engine.getOriginData(); // Access the shared original dataset.

// This clears shared data, not just one independent module's records.
engine.clearData("search");
```

## Update the stored collection

Use the engine methods to replace, append, update, or delete records so the stored data and indexes stay in sync.

### Replace data with `data()` / `dataAsync()`

`data(...)` replaces the entire stored dataset and rebuilds configured indexes synchronously. `dataAsync(...)` is the asynchronous alternative; await completion before querying the replaced data.

```ts
engine.data(users);
await engine.dataAsync(users);
```

An asynchronous return value is not a guarantee of zero main-thread work. Measure responsiveness with your actual data and runtime.

---

### Add items with `add([])`

Use `add([])` when you need to append several new items to the stored dataset.
This is different from `data(...)`:

- `data(...)` replaces the whole stored dataset.
- `add([])` appends new items to the existing stored dataset.

If indexes are already built, `add()` updates them incrementally for the new items only:

- **TextSearchEngine / FilterEngine**: already-built indexes are updated for the new items. Cost also depends on the number of indexed fields and text lengths.
- **SortEngine**: the sort cache for each configured field is invalidated on `add()` and rebuilt lazily on the next `sort()` call. This defers sort-cache rebuilding until it is needed.

If indexes have not been built yet, `add()` appends the items without touching any index.
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
- configured indexes or caches are refreshed or invalidated as needed.

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

### Delete items with `delete(...)`

Use `delete(...)` when you need to remove stored items from the original dataset by a unique field such as `id`.

- `delete(...)` changes the stored dataset.
- removal uses **swap-pop**, so order is not preserved.
- indexed engines update their internal state from the shared `State` mutation instead of rebuilding the full dataset.
- the target field values must be unique for the values you remove.

```ts
import { MergeEngines } from "@devisfuture/mega-collection";
import { TextSearchEngine } from "@devisfuture/mega-collection/search";
import { SortEngine } from "@devisfuture/mega-collection/sort";
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const merge = new MergeEngines<User>({
  imports: [TextSearchEngine, SortEngine, FilterEngine],
  data: users,
  search: { fields: ["name", "city"], minQueryLength: 2 },
  filter: { fields: ["id", "city"] },
  sort: { fields: ["age", "name"] },
});

merge.delete("id", [1, 4]);

merge.getOriginData();
merge.search("Kyiv");
merge.filter([{ field: "city", values: ["Lviv"] }]);
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

searchEngine.delete("id", 2);

const filterEngine = new FilterEngine<User>({
  data: users,
  fields: ["id", "city"],
});

filterEngine.delete("id", [1, 4]);

const sortEngine = new SortEngine<User>({
  data: users,
  fields: ["age", "name"],
});

sortEngine.delete("id", 3);
```

---

## How indexing works

### Text search: n-gram inverted indexes

Search splits indexed text into overlapping two- and three-character pieces, called n-grams. For example, `hello` includes `he`, `hel`, `el`, `ell`, `ll`, `llo`, and `lo`.

For each n-gram, an inverted index stores matching item positions. A query intersects those candidate sets, then confirms the complete substring with `String.includes`. Common queries can still produce large candidate sets.

Queries shorter than two characters use a linear scan when allowed by `minQueryLength`. Blank queries and queries below `minQueryLength` return the original dataset.

### Filtering: value indexes

For each indexed field, a map associates an exact value with matching items. Scalar values within a criterion use OR semantics; different criteria are intersected. Primitive array fields require every selected value.

A direct value lookup avoids testing every item for that value, but combining matches and constructing the returned array still take work. The complete filter operation is not universally O(1).

When relevant indexes are unavailable, filtering can use a linear fallback. Result-only exclusion also has to construct the remaining result array.

### Sorting: cached positions

Single-field sorting can cache item positions in a `Uint32Array`. The first indexed sort builds the cache; subsequent eligible calls reuse it and materialize the result array. Mutations can invalidate cached orders, which are rebuilt when needed.

Multi-field sorting is supported, but should not be assumed to have the same cache behavior as repeated single-field sorting.

## Benchmarks and performance

See [BENCHMARKS.md](https://github.com/trae-op/mega-collection/blob/main/BENCHMARKS.md) for the project's benchmark results and methodology.

To run the engine benchmarks from a development checkout after installing dependencies:

```bash
npm run search-bench
npm run filter-bench
npm run sort-bench
```

For your workload, measure:

- Index construction and the first query separately from repeated queries.
- Broad queries as well as selective queries.
- Memory use, indexed field count, and text lengths.
- Update frequency and cache rebuilding.
- Result construction and UI rendering time separately.

Start with native array methods for small or infrequently queried collections. Consider indexed processing when repeated scans or sorts become measurable bottlenecks. Large lists may also need rendering optimizations independently of data processing.

## React demo

Try the [live React demo](https://trae-op.github.io/quick-start_react_mega-collection/) or inspect the [example repository](https://github.com/trae-op/quick-start_react_mega-collection).

It demonstrates search, filtering, sorting, and `MergeEngines` with a UI. React is not a runtime dependency of this package.

## API Reference

### `MergeEngines<T>` (root module)

One class that combines search, filter, and sort for the same dataset.

**Constructor options:**

| Option                   | Type                                                        | Description                                                                                                    |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `imports`                | `Array of engine classes`                                   | Engine classes to create                                                                                       |
| `data`                   | `T[]`                                                       | Shared dataset — passed once at construction                                                                   |
| `filterByPreviousResult` | `boolean`                                                   | When `true`, separate `filter(...)` and `sort(...)` calls continue from the last result stored in shared State |
| `search`                 | `{ fields?, nestedFields?, arrayFields?, minQueryLength? }` | Config for TextSearchEngine                                                                                    |
| `filter`                 | `{ fields?, nestedFields?, arrayFields? }`                  | Config for FilterEngine                                                                                        |
| `sort`                   | `{ fields? }`                                               | Config for SortEngine                                                                                          |

**Methods:**

| Method                              | Description                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `search(query)`                     | Search all configured scalar, nested, and primitive-array fields                                                           |
| `search(field, query)`              | Search one configured scalar, nested, or primitive-array field                                                             |
| `sort(descriptors)`                 | Sort using stored dataset                                                                                                  |
| `sort(data, descriptors, inPlace?)` | Sort with an explicit dataset                                                                                              |
| `filter(criteria)`                  | Filter using stored dataset                                                                                                |
| `filter(data, criteria)`            | Filter with an explicit dataset                                                                                            |
| `getOriginData()`                   | Get the shared original dataset                                                                                            |
| `add(items)`                        | Append items, update built search/filter indexes, and invalidate sorting caches as needed                                  |
| `delete(field, valueOrValues)`      | Remove stored items by unique field value using swap-pop semantics                                                         |
| `update({ field, data })`           | Replace one stored item by a unique field and refresh the relevant indexes or caches                                       |
| `data(data)`                        | Replace stored dataset for all imported modules, rebuilding configured indexes and resetting filter state where applicable |
| `dataAsync(data)`                   | Replace stored dataset for all imported modules, resolving when all indexes are rebuilt                                    |
| `clearIndexes(module)`              | Clear indexes for one module (`"search"`, `"sort"`, `"filter"`)                                                            |
| `clearData(module)`                 | Clear the shared stored dataset through one imported module (`"search"`, `"sort"`, `"filter"`)                             |

---

### `TextSearchEngine<T>` (search module)

Text search engine.
It supports `nestedFields` if you need to search inside nested collections such as `["orders.status"]`.
It supports `arrayFields` for top-level arrays containing primitive values.
Search methods return plain arrays.

Main constructor options:

| Option                   | Type                   | Description                                                                                                                                                                     |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filterByPreviousResult` | `boolean`              | When `true`, a query that narrows the previous one (new query includes old query) searches only the previous result instead of the full dataset. Any mutation resets the state. |
| `nestedFields`           | `string[]`             | Nested field paths in dot notation, for example `["orders.status"]`.                                                                                                            |
| `arrayFields`            | `(keyof T & string)[]` | Top-level primitive-array fields to search. Supports `string`, `number`, and `boolean`; unsupported elements are ignored.                                                       |

| Method                           | Description                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `search(query, options?)`        | Search all configured scalar, nested, and primitive-array fields, deduplicated |
| `search(field, query, options?)` | Search a specific configured scalar, nested, or primitive-array field          |
| `searchAll(query, options?)`     | Explicit all-fields alias when you want pagination on broad searches           |
| `resetSearchState()`             | Reset previous-result state for sequential narrowing search                    |
| `getOriginData()`                | Get the original stored dataset                                                |
| `add(items)`                     | Append multiple items to the stored dataset                                    |
| `delete(field, valueOrValues)`   | Remove stored items by unique field value                                      |
| `update({ field, data })`        | Replace one stored item by a unique field                                      |
| `data(data)`                     | Replace stored dataset and rebuild configured indexes                          |
| `dataAsync(data)`                | Replace stored dataset and rebuild configured indexes asynchronously           |
| `clearIndexes()`                 | Clear scalar, nested, and primitive-array n-gram indexes                       |
| `clearData()`                    | Clear stored data                                                              |

`options.limit` and `options.offset` are useful for broad result sets where you only need the current page.

### `FilterEngine<T>` (filter module)

Filter engine for one or more rules.
It supports `nestedFields` if you need to filter by values inside nested collections such as `["orders.status"]`.
It supports `arrayFields` for top-level arrays containing primitive values.
Each criterion can use `values`, `exclude`, or both in the same rule.

Main constructor options:

| Option                   | Type                   | Description                                                                                                                                |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `filterByPreviousResult` | `boolean`              | When `true`, the next `filter(criteria)` call works on the previous result. By default each call starts from the original dataset.         |
| `nestedFields`           | `string[]`             | Nested field paths in dot notation, for example `["orders.status"]`.                                                                       |
| `arrayFields`            | `(keyof T & string)[]` | Top-level primitive-array fields to filter. `values` uses AND semantics; `exclude` uses ANY semantics; matching preserves primitive types. |

| Method                         | Description                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `filter(criteria)`             | Filter stored data using scalar, nested, and primitive-array criteria                     |
| `filter(data, criteria)`       | Filter an explicit dataset using scalar, nested, and primitive-array criteria             |
| `getOriginData()`              | Get the original stored dataset                                                           |
| `add(items)`                   | Append multiple items to the stored dataset                                               |
| `delete(field, valueOrValues)` | Remove stored items by unique field value                                                 |
| `update({ field, data })`      | Replace one stored item by a unique field                                                 |
| `data(data)`                   | Replace stored dataset, rebuild configured indexes, and reset filter state                |
| `dataAsync(data)`              | Replace stored dataset, rebuild configured indexes, and reset filter state asynchronously |
| `resetFilterState()`           | Reset previous-result state for sequential filtering                                      |
| `clearIndexes()`               | Free scalar, nested, and primitive-array index memory                                     |
| `clearData()`                  | Clear stored data                                                                         |

### `SortEngine<T>` (sort module)

Sort engine with prepared indexes for faster sorting in common cases.
Sort methods return plain arrays.

| Method                              | Description                                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| `sort(descriptors)`                 | Sort using stored dataset                                            |
| `sort(data, descriptors, inPlace?)` | Sort with an explicit dataset                                        |
| `getOriginData()`                   | Get the original stored dataset                                      |
| `add(items)`                        | Append multiple items to the stored dataset                          |
| `delete(field, valueOrValues)`      | Remove stored items by unique field value                            |
| `update({ field, data })`           | Replace one stored item by a unique field                            |
| `data(data)`                        | Replace stored dataset and rebuild configured indexes                |
| `dataAsync(data)`                   | Replace stored dataset and rebuild configured indexes asynchronously |
| `clearIndexes()`                    | Free all cached indexes                                              |
| `clearData()`                       | Clear stored data                                                    |

---

## Contributing

See [CONTRIBUTING.md](https://github.com/trae-op/mega-collection/blob/main/CONTRIBUTING.md) for contribution guidelines. If the package helps your project, a GitHub star is appreciated.

## Security

See [SECURITY.md](https://github.com/trae-op/mega-collection/blob/main/SECURITY.md) for the security policy.

## License

MIT — see [LICENSE](https://github.com/trae-op/mega-collection/blob/main/LICENSE).
