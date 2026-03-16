# TextSearchEngine Improvement Plan

## Context

Analysis of the benchmark results from `@devisfuture/mega-collection v2.3.5` revealed four systemic issues. Each one is described below with concrete steps to address it.

---

## Issue 1 — Performance degradation on broad result sets

**Symptom:** Query `'jo'` (~20k hits) yields only **1.25x** speedup, while `'john'` (~10k hits) yields **5.77x**.

**Root cause:** The index efficiently locates candidates, but post-index processing of large result sets (deduplication, sorting, serialization) runs linearly and cancels out the advantage.

### Steps to resolve

**1.1. Implement lazy / streaming results**

- Instead of materializing all 20k hits upfront — return an iterator or generator
- The consumer receives the first N results without materializing the rest
- This reduces peak memory usage and initial response time

**1.2. Introduce early cutoff via a `limit` parameter**

- The API should accept `{ query, limit, offset }` instead of just `{ query }`
- The index stops searching once `limit` candidates are collected
- Implement cursor-based pagination for large datasets

**1.3. Optimize deduplication**

- Current deduplication likely uses `Array.filter` + `Set` in two passes
- Replace with a single-pass through a `Map` with early exit once the limit is reached
- Avoid calling `sort()` on the full array — use a partial sort (min-heap) when only top-N results are needed

**1.4. Add bucket-level pruning inside the index**

- If the bucket for prefix `'jo'` contains more than a threshold number of entries — apply additional filters at the index level
- Prevent millions of raw candidates from ever reaching post-processing

---

## Issue 2 — Weak advantage in two-step search (Group E)

**Symptom:** Two-step `'jo'→'john'` (indexed + linear) yields only **1.27x** over native `filter + filter`.

**Root cause:** The first step (indexed) returns a wide intermediate set, and the second step (linear scan over that set) is nearly equivalent to a native filter. The advantage of the first step is nullified by the second.

### Steps to resolve

**2.1. Pass the intermediate result set between steps as an indexed structure**

- Currently the second step receives a plain array and performs a linear scan
- Instead — store the intermediate set as `Set<id>` and execute the second step as an indexed intersection, not a linear scan

**2.2. Implement query planning**

- Before executing a two-step query, analyze the selectivity of each step
- Execute the more selective step first (fewer hits)
- This is a classic relational database technique — join order optimization

**2.3. Cache intermediate results for similar queries**

- `'jo'→'john'` and `'jo'→'jones'` share an identical first step
- An LRU cache at the first-step level allows reuse of the intermediate set

---

## Issue 3 — Non-indexed fallback provides almost no advantage (Group F)

**Symptom:** Non-indexed linear fallback yields only **1.28x** — barely a micro-optimization over native JS.

**Root cause:** When the index is unavailable, the engine performs the same linear scan as native JS, but with the added overhead of its own abstraction layer.

### Steps to resolve

**3.1. Reduce abstraction overhead in fallback mode**

- Profile exactly what consumes time in fallback (wrapper objects, lifecycle hooks, event emission)
- Fallback should be as thin as possible — essentially a direct call to the native method

**3.2. Expand index coverage**

- Investigate why certain fields or scenarios fall through to fallback
- If a field type is not supported by the index — add support, or at least a partial index (first N characters)

**3.3. Introduce warnings on frequent fallback**

- Log (in dev mode) whenever a query hits the fallback path
- Provide a hint to the developer: "field X is not indexed — add it to the schema"

**3.4. Reconsider exposing fallback as a transparent behavior**

- If fallback yields only 1.28x — it may be better to make it explicit (opt-in) rather than silent
- Developers should know they are not getting the full benefit of the library

---

## Issue 4 — Missing p95 / p99 metrics

**Symptom:** The benchmark reports only p50 (median). The tail of the distribution is completely hidden.

**Root cause:** p50 can look excellent even when 5% of queries take 10x longer. For production systems this is critical information.

### Steps to resolve

**4.1. Extend the benchmark to collect p95 and p99**

- Store all N raw measurements (not just the median) and compute percentiles from them
- Minimum change: report `[p50, p95, p99]` for every row in the results table

**4.2. Investigate the nature of outliers**

- Tail latency in search is typically caused by: GC pauses, cold cache, worst-case hash collisions
- Determine whether outliers are systematic (algorithmic problem) or random (environment noise)

**4.3. Add a dedicated worst-case test scenario**

- A scenario that guarantees hitting the worst execution path: empty results, very long query strings, Unicode edge cases
- p50 on the happy path says nothing about behavior at the edges

---

## General Recommendations

### Architectural

- Split the public API into `search(query, options)` and `searchAll(query)` — so that `limit` is a first-class citizen, not an afterthought option
- Add an `explain(query)` method that returns the execution plan (which index was used, how many candidates were produced, whether fallback occurred)

### Infrastructure

- Run the benchmark on CI for every PR — regressions should block merge
- Store benchmark history to detect gradual degradation over time (performance budgets)
- Test across multiple dataset sizes: 1k, 10k, 100k, 1M — to identify where algorithmic complexity becomes a bottleneck

### Documentation

- Clearly document when the engine is effective and when it is not
- Add an explicit warning: "for queries expected to return more than 10k results, setting `limit` is strongly recommended"
- Add a decision tree: "when to use this library vs native filter"

---

## Prioritization

| Priority        | Issue                                             | Complexity | Impact |
| --------------- | ------------------------------------------------- | ---------- | ------ |
| 🔴 Critical     | Performance degradation on broad result sets (I1) | Medium     | High   |
| 🔴 Critical     | Missing p95/p99 metrics (I4)                      | Low        | High   |
| 🟡 Important    | Two-step query planning (I2)                      | High       | Medium |
| 🟢 Nice to have | Fallback overhead (I3)                            | Low        | Low    |
