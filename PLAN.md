# TextSearchEngine — Performance & Quality Improvement Plan

> Scope: `src/search/` — benchmark reference `search.bench.ts` (100 000-item dataset)
> Status: draft · 2026-03-16

---

## 1. Benchmark Diagnosis

### 1.1 How the benchmark is structured

| Group | Query                   | Fields        | Expected scenario                   |
| ----- | ----------------------- | ------------- | ----------------------------------- |
| A     | "john" (4-char)         | single `name` | indexed single-field                |
| B     | "john" (4-char)         | all 4 fields  | indexed multi-field                 |
| C     | "jo" (2-char)           | all 4 fields  | weak intersection (few grams)       |
| D     | "san antonio" (11-char) | all 4 fields  | highly selective, engine sweet-spot |
| E     | "jo"→"john"             | all 4 fields  | `filterByPreviousResult` two-step   |
| F     | "john" (4-char)         | no index      | linear fallback parity              |

### 1.2 Identified performance bottlenecks

#### B1 — Inflated n-gram index (Groups A–D, index build)

`indexLowerValue` in `ngram.ts` stores **all gram sizes 1 to `min(3, remaining)`** at
every string position. For a string of length L this creates approximately `3L − 3`
entries instead of `L − 2` (trigrams only). The ratio is roughly **3×** at typical
field value lengths (8–15 chars). Consequences:

- Index build time is ~3× longer than needed for queries ≥ 3 chars.
- Posting lists for 1-gram and 2-gram keys are extremely large (e.g. the "j" posting
  list contains all items whose any indexed field has the letter "j").
- Trigram-level posting lists carry more false positives because they share bucket space
  with shorter-gram noise entries.

`extractQueryGrams(query)` already uses only the _maximum_ gram length for the query
(`min(3, query.length)`), so the 1-gram and 2-gram index entries are only ever
consulted for 1-char and 2-char queries respectively.

**Impact scale**: affects every search call on an indexed field.  
**Fix reference**: O1 (see §2).

#### B2 — `Object.keys(item)` in `searchAllFieldsLinear` (Groups E, F)

`searchAllFieldsLinear` iterates with `Object.keys(item)` per item, allocating a fresh
`string[]` for every element of the source array. In Group E the source is the
~10 000-item `previousResult` array; in Group F the source is the full 100 000-item
dataset. This is the single biggest bottleneck for the linear path.

When `indexedFields.size > 0`, the engine already knows which fields to check. Using
`this.indexedFields` (a `Set`) for iteration avoids all per-item allocations.

**Impact scale**: O(N) allocations eliminated from both E1 and F1.  
**Fix reference**: O2 (see §2).

#### B3 — `Set<T>` per `searchAllFields` call for multi-field dedup (Groups B, C, D)

`searchAllFields` allocates `new Set<T>()` on every call to deduplicate items that
match across multiple indexed fields. With 4 fields and ~10 000 matching items per
search, this creates a HashSet with ~10 000 entries, generating GC pressure that
accumulates across rapid sequential searches.

An index-based check with a reusable `Uint8Array` (one bit per dataset slot) is
O(1)-allocated, cache-friendly, and requires no hashing of object references.

**Impact scale**: removes per-call GC pressure, measurable on repeated searches (e.g.
a search-as-you-type scenario running 10+ calls per second).  
**Fix reference**: O3 (see §2).

#### B4 — `Array.sort()` for posting-list ordering (Groups A–D)

`searchFieldWithPreparedQuery` builds a `postingLists: Set<number>[]` array and then
calls `.sort((l, r) => l.size - r.size)` to put the smallest posting list first. For
queries ≤ 12 grams (the intersection cap) this is a sort of a tiny array (max 12
elements). The allocation and comparator call overhead is small but happens on _every_
indexed search call and can be replaced with a single O(k) minimum-index scan.

**Fix reference**: O4 (see §2).

#### B5 — Group C weakness: 2-char query hits a single large posting list

For query "jo" (2 chars), `extractQueryGrams` returns only one gram `["jo"]`.
With a single posting list there is no intersection step — the engine scans every
index entry for that 2-gram and then verifies with `normalizedValues[i].includes("jo")`.
This is effectively the same as a linear scan but with an extra layer of indirection.

Once O1 (trigram-only index) is applied, 2-char queries will fall back to the clean
linear path automatically — which already exists and is well-tested. The `minQueryLength`
option (already public API) can be set to `3` by callers that never need 1–2 char
queries, fully avoiding this scenario.

**Fix reference**: O1 + new test coverage for the edge case (see §3).

---

## 2. Optimization Roadmap

### O1 — Trigram-only index + transparent short-query fallback ★ HIGHEST IMPACT

**File**: `src/search/ngram.ts`

**Change**: In `indexLowerValue`, only store the gram of length
`min(MAXIMUM_NGRAM_LENGTH, value.length)` at each start position, not all lengths
from 1 to that maximum:

```ts
// BEFORE (stores 1-gram, 2-gram, 3-gram per position)
for (let gramLength = 1; gramLength <= maxLengthAtPosition; gramLength++) {
  const ngram = lowerValue.substring(startIndex, startIndex + gramLength);
  getOrCreatePostingList(ngramMap, ngram).add(itemIndex);
}

// AFTER (stores only the maximum-length gram per position)
const ngram = lowerValue.substring(
  startIndex,
  startIndex + maxLengthAtPosition,
);
getOrCreatePostingList(ngramMap, ngram).add(itemIndex);
```

Same change must be applied symmetrically to `removeLowerValue`.

**Compatibility**: `extractQueryGrams` already returns only the maximum-length gram
for a given query length. For queries ≥ 3 chars, results are identical to today.
For queries of 1–2 chars the gram no longer exists in the index → `searchFieldWithPreparedQuery`
will get an empty `postingLists` array after `ngramMap.get(gram)` returns `undefined`
and returns `[]`. The engine must route such queries to the linear fallback instead.

**Additional change**: In `text-search.ts`, in the `searchField` and `searchAllFields`
code paths, guard the indexed path with:

```ts
// Only use the index when the query is long enough to produce a trigram.
const MIN_INDEXED_QUERY = MAXIMUM_NGRAM_LENGTH; // export from ngram.ts
if (lowerQuery.length < MIN_INDEXED_QUERY) {
  // fall through to linear scan — safe, already tested
}
```

This is not a breaking API change: callers that genuinely need 1–2 char indexed
results already set `minQueryLength` ≤ 2 **and** currently get those results from the
2-gram index. After O1, those same callers will get identical results through the
linear path (which has always been the fallback). The only observable difference is
that the linear path is slightly slower than the 2-gram index for very short queries —
document this in the JSDoc of `minQueryLength`.

**Expected gains**:

- Index memory: ~3× reduction (from ~3L gram entries per string to ~L entries).
- Index build time: ~3× faster (fewer `Set.add` calls per string).
- Search for queries ≥ 3 chars: posting lists are ~3× smaller → intersection faster.
- Group C (2-char "jo"): linear path replaces the noisy single-posting-list scan.

---

### O2 — Replace `Object.keys(item)` in linear scan ★ HIGH IMPACT

**File**: `src/search/text-search.ts`

**Change**: Cache the list of string fields to scan instead of calling `Object.keys`
per item. When `indexedFields.size > 0`, those are exactly the fields to check. For
the no-index case, compute the field list once from the first item and reuse it.

```ts
private searchAllFieldsLinear(data: T[], lowerQuery: string): T[] {
  if (!data.length) return [];

  // Use known indexed fields when available; fall back to first-item keys.
  const fields: string[] =
    this.indexedFields.size > 0
      ? Array.from(this.indexedFields)
      : Object.keys(data[0]).filter((k) => typeof data[0][k] === "string");

  const matchedItems: T[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    let hasMatch = false;

    for (let f = 0; f < fields.length; f++) {
      const value = item[fields[f]];
      if (typeof value === "string" && value.toLowerCase().includes(lowerQuery)) {
        hasMatch = true;
        break;
      }
    }

    if (!hasMatch) hasMatch = this.nestedCollection.matchesAnyField(item, lowerQuery);
    if (hasMatch) matchedItems.push(item);
  }

  return matchedItems;
}
```

Note: moving the `fields` array outside the hot loop also opens the door for caching
it in the runtime object (compute once on first call, store in `SearchRuntime`).

**Expected gains**:

- Group E1: eliminates ~10 000 `Object.keys` allocations per two-step search.
- Group F1: eliminates ~100 000 `Object.keys` allocations per linear search.
- Both groups should match or slightly beat native `Array.filter`.

---

### O3 — Replace `Set<T>` dedup with a `Uint8Array` position map ★ MEDIUM IMPACT

**File**: `src/search/text-search.ts`

**Change**: In `searchAllFields`, instead of `new Set<T>()` to track seen items, use
a `Uint8Array(dataset.length)` that is indexed by position:

```ts
private searchAllFields(query: string): T[] {
  // ...
  const seen = new Uint8Array(this.dataset.length); // stack allocation, no GC
  const combined: T[] = [];

  for (const [field] of this.flatIndexes) {
    const indices = this.searchFieldWithPreparedQueryIndices(
      field, lowerQuery, uniqueQueryGrams,
    );
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      if (seen[idx]) continue;
      seen[idx] = 1;
      combined.push(this.dataset[idx]);
    }
  }
  // ... nested collection similarly
  return combined;
}
```

This requires an internal variant of `searchFieldWithPreparedQuery` that returns
`number[]` (candidate indices) instead of `T[]`. The public `search()` API is unchanged.

**Expected gains**:

- Eliminates one `Set<T>` heap allocation per indexed multi-field search call.
- Uint8Array typed-array access is CPU cache-friendly (no hash computation).
- In search-as-you-type scenarios (many rapid calls), measurable GC reduction.

---

### O4 — Replace `Array.sort()` with find-min in posting-list intersection ★ MINOR

**File**: `src/search/text-search.ts` and `src/search/nested.ts`

**Change**: The only reason for sorting `postingLists` is to put the smallest list
first (to minimize the outer iteration). This can be done in O(k) without allocating a
sort comparator:

```ts
// Find index of smallest posting list
let minIdx = 0;
for (let i = 1; i < postingLists.length; i++) {
  if (postingLists[i].size < postingLists[minIdx].size) minIdx = i;
}
// Swap to front without allocating a new array
if (minIdx !== 0) {
  const tmp = postingLists[0];
  postingLists[0] = postingLists[minIdx];
  postingLists[minIdx] = tmp;
}
```

The same pattern exists in `nested.ts → searchIndexedField`; apply there too.

---

## 3. Code Review — Recent Changes

### 3.1 Correctness

| #    | Location                         | Observation                                                                                                                                                                                                                                                                                                                                                                                                               | Risk                                                   |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| CR-1 | `handleStateMutation`            | Every `case` block duplicates `runtime.previousResult = null; runtime.previousQuery = null`. Extract to a private `clearPreviousSearchState()` method.                                                                                                                                                                                                                                                                    | Low (style/DRY)                                        |
| CR-2 | `updateIndexedField`             | Performs incremental update _and_ bumps `index.version` to the new mutation version. `searchFieldWithPreparedQuery` then finds `index.version === currentVersion` and skips the lazy rebuild — correct. But this means the lazy rebuild guard in `searchFieldWithPreparedQuery` is only an emergency fallback (unreachable in normal mutation flow). A comment documenting this invariant would prevent future confusion. | Low (documentation gap)                                |
| CR-3 | `moveIndexedFieldValue`          | Uses `normalizedValues[fromIndex] ?? this.getNormalizedFieldValue(item, field)` as a fallback. The fallback calls `item[field].toLowerCase()` — safe, but redundant if `normalizedValues` is always kept in sync on add/update. Worth an assertion or comment.                                                                                                                                                            | Low                                                    |
| CR-4 | `searchAllFields`                | When `source !== this.dataset` (previous-result narrowing), calls `searchAllFieldsLinear(source, lowerQuery)` which iterates `Object.keys(item)`. The indexed field names in `this.indexedFields` are ignored. This is B2's root cause.                                                                                                                                                                                   | **Medium** (perf regression on filterByPreviousResult) |
| CR-5 | `searchField`                    | Rebuilds `uniqueQueryGrams` via `buildIntersectionQueryGrams` separately for nested and flat paths. Could be computed once at the top of `searchField`.                                                                                                                                                                                                                                                                   | Low (minor duplication)                                |
| CR-6 | `nested.ts — searchIndexedField` | Builds `normalizedValues = this.storage.normalizedFieldValues.get(fieldPath)` on every call but `fieldPath` may appear in multiple fields — the per-call `.get()` is fine, but the result could be stored in a local at the top of the method for the subsequent candidateIndex loop. Already done correctly — just note it is correct.                                                                                   | None                                                   |
| CR-7 | `buildIntersectionQueryGrams`    | When `allGrams.length > 12`, samples up to 12 grams evenly. This spreads coverage across the query but skips potentially more-selective middle grams. A future improvement could sort by estimated rarity (ascending by postingList size) rather than evenly sampling.                                                                                                                                                    | Low (future)                                           |

### 3.2 API surface

- `resetSearchState()` was added but has no entry in `TextSearchEngineOptions` docs
  showing the complementary option. Add a JSDoc cross-reference between
  `filterByPreviousResult` and `resetSearchState()`.
- `minQueryLength` default of `1` allows 1-char queries to hit the index. After O1
  these will fall back to linear. Document the performance trade-off explicitly in the
  JSDoc block.

---

## 4. Tests — New & Updated

### 4.1 New test cases to add in `text-search.test.ts`

| #   | Test description                                                                                                                                                                                                   | Why needed                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| T1  | `searchAllFieldsLinear` uses indexed field names when fields are configured — verify no `Object.keys` side-effects by swapping a field after construction                                                          | Covers O2 regression                                   |
| T2  | `filterByPreviousResult`: `search("jo")` then `search("john")` on 4-field engine returns same results as two independent indexed searches                                                                          | Covers Group E correctness end-to-end                  |
| T3  | `resetSearchState()` mid-narrowing: after `search("jo")`, call `resetSearchState()`, then `search("john")` must re-search from full dataset, not previous result                                                   | Documents and locks `resetSearchState()` contract      |
| T4  | 2-char query with `minQueryLength: 1` after O1 (trigram-only index): must still return correct results via linear fallback                                                                                         | Validates O1 does not regress short-query correctness  |
| T5  | Multi-field search deduplication after O3 (Uint8Array path): item matching in two indexed fields appears exactly once in results                                                                                   | Covers O3 regression                                   |
| T6  | Index size sanity (post-O1): after building the index for a 1000-item dataset with a known field, verify `flatIndexes.get(field).ngramMap.size` is ≤ expected trigram count; assert no 1-gram or 2-gram keys exist | Locks the O1 index structure contract                  |
| T7  | `filterByPreviousResult` + `data()` replacement: calling `data(newItems)` must clear `previousResult`; next search scans the new full dataset                                                                      | Guards the mutation-reset contract                     |
| T8  | `clearIndexes()` + `search(field, query)` falls back to linear and returns correct results even when `indexedFields` is non-empty                                                                                  | Documents the `clearIndexes` + field-known linear path |
| T9  | `search(query)` (all-fields, no index configured) with item that has non-string fields: must skip non-strings and not throw                                                                                        | Regression for `searchAllFieldsLinear` type guard      |

### 4.2 Updates to existing tests

| Existing test                                                      | Required update                                                                                                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"exercises long-query subsampling path (>12 grams)"`              | After O1, the long query "react-window" (12 chars → 10+ trigrams) still hits the sampled intersection path; verify result count still equals `cards.length`.                      |
| `"minQueryLength blocks short queries by returning original data"` | After O1, a 2-char query below `minQueryLength` falls through linear, not the 2-gram index. Verify both paths (minQueryLength: 1 and minQueryLength: 3) return identical results. |
| `"works without fields in constructor via linear search fallback"` | After O2, linear scan uses first-item field keys. Test with an item type that has a mix of string and number fields to ensure the key filter is correct.                          |
| Group E benchmark scenario (informal)                              | Add an integration-level test that runs the exact E1 two-step pattern at 10k items and asserts result correctness (not timing).                                                   |

### 4.3 Benchmark validation after each optimization

Run `npx tsx src/search/search.bench.ts` after each phase and record the p50 values in
this table (to be filled in during implementation):

| Group | Scenario                           | Baseline p50 | After O1 | After O2 | After O3 |
| ----- | ---------------------------------- | ------------ | -------- | -------- | -------- |
| A1    | Engine single-field "john"         | ? ms         |          |          |          |
| B1    | Engine multi-field "john"          | ? ms         |          |          |          |
| C1    | Engine multi-field "jo"            | ? ms         |          |          |          |
| D1    | Engine multi-field "san antonio"   | ? ms         |          |          |          |
| E1    | filterByPreviousResult "jo"→"john" | ? ms         |          |          |          |
| F1    | Engine linear fallback "john"      | ? ms         |          |          |          |

---

## 5. Implementation Sequence

```
Phase 1 (correctness-safe, no API change)
  1. O2 — fix Object.keys in searchAllFieldsLinear         (text-search.ts)
  2. O4 — replace Array.sort with find-min                  (text-search.ts, nested.ts)
  3. CR-1 — extract clearPreviousSearchState()              (text-search.ts)
  4. Run full test suite + bench → record p50 baseline

Phase 2 (index architecture change, requires T4 and T6 tests first)
  5. Write T4, T6, T8, T9 tests (must pass before O1)
  6. O1 — trigram-only indexLowerValue / removeLowerValue   (ngram.ts)
  7. O1 continuation — guard short-query path in text-search.ts
  8. Run full test suite → all tests green
  9. Run bench → record post-O1 p50

Phase 3 (internal refactor, no public API change)
  10. O3 — Uint8Array dedup in searchAllFields              (text-search.ts)
  11. Write T1, T2, T3, T5, T7 tests
  12. Final bench run → fill in table §4.3
  13. Update JSDoc for minQueryLength and filterByPreviousResult / resetSearchState
```

---

## 6. Acceptance Criteria

- All existing tests pass with no modifications to assertions.
- All new tests in §4.1 are green.
- Benchmark p50 for **every engine scenario** (A1–F1) stays ≤ 200 ms.
- Benchmark memory for every scenario stays ≤ 30 MB.
- No public API types or method signatures change.
- `indexLowerValue` no longer generates 1-gram or 2-gram keys for strings of length ≥ 3
  (verifiable via T6).
- `searchAllFieldsLinear` no longer calls `Object.keys` inside the item loop when
  `indexedFields.size > 0` (verifiable via T9 and code inspection).
