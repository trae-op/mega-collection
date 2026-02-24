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

Import only the module you need — like `lodash`, each sub-module is fully independent:

```ts
interface User {
  id: number;
  name: string;
  city: string;
  age: number;
}
```

### Search only

```ts
import { TextSearchEngine } from "@devisfuture/mega-collection/search";

const search = new TextSearchEngine<User>();
search.buildIndex(users, "name");
search.search("name", "john");
```

### Filter only

```ts
import { FilterEngine } from "@devisfuture/mega-collection/filter";

const filter = new FilterEngine<User>()
  .buildIndex(users, "city")
  .buildIndex(users, "age");

filter.filter(users, [
  { field: "city", values: ["Kyiv", "Lviv"] },
  { field: "age", values: [25, 30, 35] },
]);
```

### Sort only

```ts
import { SortEngine } from "@devisfuture/mega-collection/sort";

// With index: first sort O(n log n), every repeat O(n)
const sorter = new SortEngine<User>().buildIndex(users, "age");
const sorted = sorter.sort(users, [{ field: "age", direction: "asc" }]);

// Without index (multi-field): always O(n log n)
const sorted2 = sorter.sort(users, [
  { field: "age", direction: "asc" },
  { field: "name", direction: "desc" },
]);
```

## API Reference

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

| Method                    | Description                           |
| ------------------------- | ------------------------------------- |
| `buildIndex(data, field)` | Build hash-map index for a field O(n) |
| `filter(data, criteria)`  | Apply filter criteria                 |
| `clearIndexes()`          | Free all index memory                 |

### `SortEngine<T>` (sort module)

High-performance sorting with pre-compiled comparators and cached sort indexes.

| Method                              | Description                                 |
| ----------------------------------- | ------------------------------------------- |
| `buildIndex(data, field)`           | Pre-sort index for a field. O(n log n) once |
| `sort(data, descriptors, inPlace?)` | Sort — O(n) with index, O(n log n) without  |
| `clearIndexes()`                    | Free all cached indexes                     |

## Types

All types are exported from the main package and from each sub-module:

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

## Architecture

```
src/
  types.ts               — Shared type definitions
  indexer.ts              — Hash-Map index engine (internal, O(1) lookups)
  search/
    text-search.ts       — Trigram inverted index engine
    index.ts             — Search module entry point
  filter/
    filter.ts            — Multi-criteria filter engine (owns Indexer internally)
    index.ts             — Filter module entry point
  sort/
    sorter.ts            — Sort engine (TimSort + index-sort)
    index.ts             — Sort module entry point
  index.ts               — Barrel export
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
