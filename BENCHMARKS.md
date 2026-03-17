# Benchmarks

## Environment

These benchmarks were collected using the same environment information printed by each benchmark script.

```
Measured on  @devisfuture/mega-collection v2.3.5
Environment  Node.js v22.13.1 · macOS 12 Monterey 12.7.6 · Intel(R) Core(TM) i5-5257U CPU @ 2.70GHz · 8 GB RAM
Benchmark    Warmup: 3 un-timed runs · Measured: 15 timed runs per scenario
Metrics      p50 / p95 / p99 latency across all iterations (lower is better)
Reproduce    npm run <bench>
```

---

## TextSearchEngine

Benchmarks below compare `TextSearchEngine` against a baseline native `Array.filter` implementation. The tables use **p50 (median)** latency across all runs (lower is better) and show how many times faster the indexed search is compared to the baseline.

### Summary

| Scenario                                                      | TextSearchEngine p50 | Native p50 | Speedup        |
| ------------------------------------------------------------- | -------------------- | ---------- | -------------- |
| A — single-field 'john' (~10k hits)                           | 1.5 ms               | 6.5 ms     | 4.3×           |
| B — all-fields 'john' (~10k hits)                             | 3.8 ms               | 18.1 ms    | 4.8×           |
| C — all-fields 'jo' (~20k hits, fewer trigrams)               | 4.8 ms               | 19.1 ms    | 4.0×           |
| D — all-fields 'san antonio' (~10k hits, highly selective)    | 8.4 ms               | 17.1 ms    | 2.0×           |
| E — two-step 'jo'→'john' (filterByPreviousResult)             | 9.7 ms               | 25 ms      | 2.6×           |
| E-step2 — pre-warmed step 2 only (narrow vs re-filter subset) | 2.6 ms               | 4.3 ms     | 1.7×           |
| F — non-indexed linear fallback (parity check)                | 5 ms                 | 17.8 ms    | 3.6×           |
| G — absent long query, worst-case scan                        | 0 ms                 | 12.4 ms    | ∞× (cache hit) |

### Per-scenario tail latency (p95 / p99 / max)

| Scenario                                                                          | p50     | p95     | p99     | Max     |
| --------------------------------------------------------------------------------- | ------- | ------- | ------- | ------- |
| TextSearchEngine - indexed single-field (name, query: 'john')                     | 1.5 ms  | 1.9 ms  | 1.9 ms  | 1.9 ms  |
| Native Array.filter - single-field (name.toLowerCase includes 'john')             | 6.5 ms  | 8.5 ms  | 8.5 ms  | 8.5 ms  |
| TextSearchEngine - indexed all-fields (query: 'john')                             | 3.8 ms  | 5.8 ms  | 5.8 ms  | 5.8 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'john')        | 18.1 ms | 19.1 ms | 19.1 ms | 19.1 ms |
| TextSearchEngine - indexed all-fields (query: 'jo')                               | 4.8 ms  | 8.6 ms  | 8.6 ms  | 8.6 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'jo')          | 19.1 ms | 20.1 ms | 20.1 ms | 20.1 ms |
| TextSearchEngine - indexed all-fields (query: 'san antonio')                      | 8.4 ms  | 23.2 ms | 23.2 ms | 23.2 ms |
| Native Array.filter - all-fields (every field.toLowerCase includes 'san antonio') | 17.1 ms | 18.9 ms | 18.9 ms | 18.9 ms |
| TextSearchEngine - filterByPreviousResult two-step search ('jo' → 'john')         | 9.7 ms  | 14.1 ms | 14.1 ms | 14.1 ms |
| Native two-step: nativeAllFields('jo') then re-filter result for 'john'           | 25 ms   | 30.4 ms | 30.4 ms | 30.4 ms |
| TextSearchEngine - step 2 only (pre-warmed 'jo' intermediate)                     | 2.6 ms  | 4.1 ms  | 4.1 ms  | 4.1 ms  |
| Baseline step 2 only - linear re-filter over pre-warmed 'jo' subset               | 4.3 ms  | 5.6 ms  | 5.6 ms  | 5.6 ms  |
| TextSearchEngine - non-indexed linear fallback (query: 'john')                    | 5 ms    | 9.4 ms  | 9.4 ms  | 9.4 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'john')        | 17.8 ms | 19.7 ms | 19.7 ms | 19.7 ms |
| TextSearchEngine - indexed all-fields worst-case absent long query                | 0 ms    | 0.1 ms  | 0.1 ms  | 0.1 ms  |
| Native Array.filter - all-fields worst-case absent long query                     | 12.4 ms | 14 ms   | 14 ms   | 14 ms   |

---

## FilterEngine

These benchmarks compare `FilterEngine` against a baseline native `Array.filter` approach. The key metric is how fast the engine returns results when reusing cached index lookups (common in repeated or session-based queries).

### Summary

| Scenario                                    | FilterEngine p50 | Native p50 | Speedup |
| ------------------------------------------- | ---------------- | ---------- | ------- |
| A — single-call overhead                    | 0.2 ms           | 1.9 ms     | 9.5×    |
| B — 5 repeated queries                      | 2.1 ms           | 10 ms      | 4.8×    |
| C — 20 repeated queries                     | 2.1 ms           | 43.1 ms    | 20.5×   |
| D — 30-query session (2 criteria, 3 phases) | 1.9 ms           | 103.1 ms   | 54.3×   |

### Per-scenario tail latency (p95 / p99 / max)

| Scenario                                                              | p50      | p95      | p99      | Max      |
| --------------------------------------------------------------------- | -------- | -------- | -------- | -------- |
| Native Array.filter — single-field equality (100k scanned, baseline)  | 1.9 ms   | 4.4 ms   | 4.4 ms   | 4.4 ms   |
| FilterEngine indexed — single-field (1 compute, result cached)        | 0.2 ms   | 0.5 ms   | 0.5 ms   | 0.5 ms   |
| Native × 5 — 5 identical filters, no cache (5 × 100k scans)           | 10 ms    | 12.4 ms  | 12.4 ms  | 12.4 ms  |
| FilterEngine × 5 — 5 identical filters: 1 compute + 4 cache hits      | 2.1 ms   | 4.6 ms   | 4.6 ms   | 4.6 ms   |
| Native × 20 — 20 identical filters, no cache (20 × 100k scans)        | 43.1 ms  | 49.6 ms  | 49.6 ms  | 49.6 ms  |
| FilterEngine × 20 — 20 identical filters: 1 compute + 19 cache hits   | 2.1 ms   | 7.9 ms   | 7.9 ms   | 7.9 ms   |
| Native session × 30 — 3 criteria phases × 10 queries each (30 × 100k) | 103.1 ms | 110.4 ms | 110.4 ms | 110.4 ms |
| FilterEngine session × 30 — 2 computes + 28 cache hits (map persists) | 1.9 ms   | 5 ms     | 5 ms     | 5 ms     |

---

## SortEngine

Benchmarks below compare `SortEngine` to the baseline `Array.sort` implementation. The reported **p50** is the median latency across all runs. The engine is especially faster for indexed sorts where the sort order is pre-computed.

### Summary

| Scenario                                            | SortEngine p50 | Native p50 | Speedup |
| --------------------------------------------------- | -------------- | ---------- | ------- |
| 1. SortEngine - indexed numeric (asc)               | 1 ms           | 46.2 ms    | 46.2×   |
| 2. SortEngine - indexed numeric (desc)              | 0.9 ms         | 46.2 ms    | 51.3×   |
| 3. SortEngine - non-indexed numeric                 | 6 ms           | 46.2 ms    | 7.7×    |
| 4. SortEngine - multi-field (value asc, score desc) | 6.6 ms         | 46.2 ms    | 7.0×    |
| 5. SortEngine - indexed string (label asc)          | 0.9 ms         | 46.2 ms    | 51.3×   |
| 6. SortEngine - ad-hoc external sort (value asc)    | 6 ms           | 46.2 ms    | 7.7×    |

### Per-scenario tail latency (p95 / p99 / max)

| Scenario                                         | p50     | p95     | p99     | Max     |
| ------------------------------------------------ | ------- | ------- | ------- | ------- |
| SortEngine - indexed numeric (asc)               | 1 ms    | 4 ms    | 4 ms    | 4 ms    |
| SortEngine - indexed numeric (desc)              | 0.9 ms  | 2.7 ms  | 2.7 ms  | 2.7 ms  |
| SortEngine - non-indexed numeric                 | 6 ms    | 7.9 ms  | 7.9 ms  | 7.9 ms  |
| SortEngine - multi-field (value asc, score desc) | 6.6 ms  | 8.9 ms  | 8.9 ms  | 8.9 ms  |
| SortEngine - indexed string (label asc)          | 0.9 ms  | 2.5 ms  | 2.5 ms  | 2.5 ms  |
| SortEngine - ad-hoc external sort (value asc)    | 6 ms    | 7.4 ms  | 7.4 ms  | 7.4 ms  |
| Native Array.sort (value asc, baseline)          | 46.2 ms | 50.2 ms | 50.2 ms | 50.2 ms |
