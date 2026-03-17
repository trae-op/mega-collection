# Cleanup & Refactoring Plan

## Overview

This plan documents all identified issues across the core engine modules
(`MergeEngines`, `SortEngine`, `TextSearchEngine`, `FilterEngine`) and the
supporting infrastructure (`State`, `Indexer`, constants, types).

The benchmarks in the screenshots show satisfactory performance numbers.
**No changes to hot-path logic or caching strategies are in scope.**
The goal is to eliminate dead code, reduce duplication, and tighten the
implementation without touching anything that could affect throughput or
latency.

---

## Phase 0 — Prerequisites (read before writing any code)

### 0.1 Read all skill files

Read and internalize the following skill guides so every code change
follows the project's established conventions:

- `.agents/skills/variables/SOURCE.md` — naming rules (`const`/`let`, camelCase,
  boolean prefixes, plural arrays)
- `.agents/skills/if-else/SOURCE.md` — guard clauses, ternary, no nested
  conditionals
- `.agents/skills/set-and-map/SOURCE.md` — when to prefer `Set`/`Map` over
  arrays/objects and how to use them efficiently
- `.agents/skills/large-collection-deletion/SOURCE.md` — swap-and-pop O(1)
  deletion patterns used throughout `State` and `SortEngine`

### 0.2 Read README.md

Read the full `README.md` at the project root to understand the public API,
usage patterns, and the guarantees each engine is expected to provide to
consumers. Changes must not break any documented behavior.

---

## Phase 1 — Analysis Results

The following issues were identified by reading every source file in
`src/`. They are grouped by type.

### 1.1 Duplicated constants

| Constant                                  | Defined in                                                 |
| ----------------------------------------- | ---------------------------------------------------------- |
| `MERGE_SHARED_SCOPE = "__merge__"`        | `src/filter/constants.ts` ✱                                |
|                                           | `src/sort/constants.ts` ✱                                  |
|                                           | `src/merge/constants.ts` (canonical)                       |
|                                           | `src/search/text-search.ts` (inline `const`, not exported) |
| `DEFER_SORT_MUTATION_CACHE_UPDATES_KEY`   | `src/sort/constants.ts`                                    |
|                                           | `src/merge/constants.ts`                                   |
| `DEFER_FILTER_MUTATION_INDEX_UPDATES_KEY` | `src/filter/constants.ts`                                  |
|                                           | `src/merge/constants.ts`                                   |
| `DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY` | `src/merge/constants.ts`                                   |
|                                           | `src/search/text-search.ts` (inline)                       |

`src/search/constants.ts` does **not** export `DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY`
even though it exports the n-gram length constants. The inline definitions in
`text-search.ts` are the root problem.

### 1.2 Dead / unnecessary code

#### `SortEngine` — `reconstructFromIndex` private method (`src/sort/sorter.ts`)

```typescript
// Called once in sortNumericFastPath — unnecessary wrapper:
private reconstructFromIndex(data, indexes, direction): T[] {
  return this.materializeItemsFromIndexes(data, indexes, direction);
}
```

One-line delegating wrapper with no added logic. The single call site should
call `materializeItemsFromIndexes` directly.

#### `MergeEngines` — `getFilterCriterionValue` private method (`src/merge/merge-engines.ts`)

```typescript
// Single call site (doesItemMatchFilterCache) — unnecessary helper:
private getFilterCriterionValue(item: T, field: string): unknown {
  return item[field as keyof T];
}
```

One-liner wrapping a simple property access. Inline the expression at the
single call site.

#### `MergeEngines` — `normalizeSearchQuery` private method (`src/merge/merge-engines.ts`)

```typescript
// Single call site — unnecessary helper:
private normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}
```

Inline the expression directly at the single call site.

### 1.3 Structural type duplication

`FilterNestedCollectionStorage<T>` in `src/filter/types.ts` has an identical
shape to `IndexerStorage<T>` exported from `src/indexer.ts`:

```typescript
// Both define exactly:
{
  indexes: Map<string, Map<any, T[]>>;
  itemPositions: Map<string, Map<any, WeakMap<T, number>>>;
}
```

`FilterNestedCollectionStorage<T>` should become a type alias of
`IndexerStorage<T>` to remove the duplication without changing any runtime
behavior.

### 1.4 Identical error messages — `FilterEngineError`

`src/filter/errors.ts` has two static factory methods that produce the same
error message:

```typescript
static missingDatasetForBuildIndex(): FilterEngineError {
  return new FilterEngineError("FilterEngine: no dataset in memory.");
}
static missingDatasetForFilter(): FilterEngineError {
  return new FilterEngineError("FilterEngine: no dataset in memory.");
}
```

Give each factory its own distinct, specific message so the throw site is
identifiable from the error text alone.

### 1.5 Redundant `setFilterByPreviousResult` call in `FilterEngine` constructor

In `src/filter/filter.ts`, when no shared state is passed in, the state is
already created with the correct `filterByPreviousResult` value:

```typescript
this.state =
  options.state ??
  new State(options.data ?? [], {
    filterByPreviousResult: options.filterByPreviousResult ?? false,
  });

// Redundant when options.state is undefined — the state was already created
// with the right value above:
if (options.filterByPreviousResult) {
  this.state.setFilterByPreviousResult(true);
}
```

The `setFilterByPreviousResult` call should only run when a pre-existing
shared state (`options.state`) was provided, so the caller's opt-in applies
to that external state without re-creating it.

---

## Phase 2 — Planned changes (ordered by risk, low first)

### Task 2.1 — Add missing constant to `src/search/constants.ts`

**File:** `src/search/constants.ts`

Add `DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY` alongside the existing n-gram
constants. This unblocks the removal of the inline constant in `text-search.ts`.

### Task 2.2 — Remove inline constants from `src/search/text-search.ts`

**File:** `src/search/text-search.ts`

Replace the two module-level `const` declarations:

```typescript
const MERGE_SHARED_SCOPE = "__merge__";
const DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY =
  "deferSearchMutationIndexUpdates";
```

with imports from the appropriate constants files:

```typescript
import { DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY } from "./constants";
import { MERGE_SHARED_SCOPE } from "../merge/constants";
```

`MERGE_SHARED_SCOPE` is already the canonical export from `src/merge/constants.ts`,
so importing it from there avoids yet another copy.

> **Architecture note:** `src/filter/constants.ts` and `src/sort/constants.ts`
> currently re-export their own copy of `MERGE_SHARED_SCOPE`. Consolidate them
> to re-export from `src/merge/constants.ts` instead (see Task 2.3).

### Task 2.3 — Consolidate `MERGE_SHARED_SCOPE` copies

**Files:** `src/filter/constants.ts`, `src/sort/constants.ts`

Both files define `export const MERGE_SHARED_SCOPE = "__merge__"`. Replace
each own definition with a re-export from `src/merge/constants.ts`:

```typescript
export { MERGE_SHARED_SCOPE } from "../merge/constants";
```

The consuming files (`filter.ts`, `sorter.ts`) already import from their
own constants file so no import paths in those files need changing.

### Task 2.4 — Remove `reconstructFromIndex` wrapper in `src/sort/sorter.ts`

**File:** `src/sort/sorter.ts`

Delete the `reconstructFromIndex` private method and update its single call
site in `sortNumericFastPath` to call `materializeItemsFromIndexes` directly:

```typescript
// Before
return this.reconstructFromIndex(data, indexes, direction);

// After
return this.materializeItemsFromIndexes(data, indexes, direction);
```

### Task 2.5 — Inline `getFilterCriterionValue` in `src/merge/merge-engines.ts`

**File:** `src/merge/merge-engines.ts`

Delete the `getFilterCriterionValue` private method. At its single call site
in `doesItemMatchFilterCache`, replace the call with the direct expression:

```typescript
// Before
const fieldValue = this.getFilterCriterionValue(item, String(criterion.field));

// After
const fieldValue = item[criterion.field as keyof T];
```

### Task 2.6 — Inline `normalizeSearchQuery` in `src/merge/merge-engines.ts`

**File:** `src/merge/merge-engines.ts`

Delete the `normalizeSearchQuery` private method. At its single call site
in the `search` method, replace the call with the direct expression:

```typescript
// Before
lowerQuery: this.normalizeSearchQuery(maybeQuery ?? fieldOrQuery),

// After
lowerQuery: (maybeQuery ?? fieldOrQuery).trim().toLowerCase(),
```

### Task 2.7 — Alias `FilterNestedCollectionStorage<T>` in `src/filter/types.ts`

**File:** `src/filter/types.ts`

Replace the standalone interface definition with a type alias of the already-
imported `IndexerStorage<T>`:

```typescript
// Before
export interface FilterNestedCollectionStorage<T extends CollectionItem> {
  indexes: Map<string, Map<any, T[]>>;
  itemPositions: Map<string, Map<any, WeakMap<T, number>>>;
}

// After
import type { IndexerStorage } from "../indexer";
export type FilterNestedCollectionStorage<T extends CollectionItem> =
  IndexerStorage<T>;
```

No change is required in `src/filter/nested.ts` or `src/filter/utils.ts`
because the type alias is structurally identical.

### Task 2.8 — Distinct error messages for `FilterEngineError`

**File:** `src/filter/errors.ts`

Give each factory a specific message so the source of the error is
immediately obvious:

```typescript
static missingDatasetForBuildIndex(): FilterEngineError {
  return new FilterEngineError(
    "FilterEngine: no dataset in memory. Call data() or add() before buildIndex().",
  );
}

static missingDatasetForFilter(): FilterEngineError {
  return new FilterEngineError(
    "FilterEngine: no dataset in memory. Call data() or add() before filter().",
  );
}
```

### Task 2.9 — Fix redundant `setFilterByPreviousResult` in `FilterEngine` constructor

**File:** `src/filter/filter.ts`

Wrap the call so it only executes when a pre-existing state is injected:

```typescript
// Before
this.state =
  options.state ??
  new State(options.data ?? [], {
    filterByPreviousResult: options.filterByPreviousResult ?? false,
  });
if (options.filterByPreviousResult) {
  this.state.setFilterByPreviousResult(true);
}

// After
this.state =
  options.state ??
  new State(options.data ?? [], {
    filterByPreviousResult: options.filterByPreviousResult ?? false,
  });
if (options.state && options.filterByPreviousResult) {
  this.state.setFilterByPreviousResult(true);
}
```

---

## Phase 3 — Code review after all changes

After all tasks in Phase 2 are committed:

1. **Re-read every modified file** in full, looking for:
   - Any remaining duplicate string literals for the constants
   - Any dangling imports that are no longer referenced
   - Any dead code introduced or exposed by the changes (e.g. methods that
     now have zero call sites after inlining)
   - Any variable names that violate the naming conventions from the skill
     guides (`const`-by-default, boolean `is`/`has` prefix, plural arrays)

2. **Check exports** — confirm `src/index.ts` and `src/merge/index.ts` still
   export all public symbols and that no internal type has accidentally been
   leaked.

3. **Run TypeScript compiler** (`npx tsc --noEmit`) and resolve all errors
   before proceeding to tests.

---

## Phase 4 — Test update and verification

### 4.1 Run the existing test suite

```bash
npm test
```

All tests must pass without modification. If any test fails after a
"pure cleanup" change it indicates a behavioral regression and the change
must be reviewed before continuing.

### 4.2 Verify or add tests for changed areas

| Change                                                           | Test file to check / update                                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distinct `FilterEngineError` messages (Task 2.8)                 | `src/filter/filter.test.ts` — ensure tests that `expect(error.message).toContain(...)` use the new text, or update them.                           |
| `FilterEngine` constructor behavior (Task 2.9)                   | `src/filter/filter.test.ts` — verify that passing a shared state + `filterByPreviousResult: true` still activates the feature on the shared state. |
| `DEFER_SEARCH_MUTATION_INDEX_UPDATES_KEY` import path (Task 2.2) | `src/search/text-search.test.ts` — no logic change, but confirm no import errors.                                                                  |

---

## Phase 5 — Final checklist

- [ ] All ESLint / TypeScript errors are resolved (`npm run lint`, `npx tsc --noEmit`)
- [ ] All unit tests pass (`npm test`)
- [ ] Benchmark numbers are within acceptable tolerance of the baseline
- [ ] No new `TODO` or `FIXME` comments were introduced
- [ ] No public API signatures were changed
- [ ] README.md does not need updating (pure internal cleanup)
