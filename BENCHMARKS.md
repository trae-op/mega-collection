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

| Scenario                                                      | TextSearchEngine p50                    | Native p50                              | Speedup                                         |
| ------------------------------------------------------------- | --------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| A — single-field 'john' (~10k hits)                           | <span style="color:green">1.6 ms</span> | <span style="color:#666">6.1 ms</span>  | <span style="color:green">3.8× faster</span>    |
| B — all-fields 'john' (~10k hits)                             | <span style="color:green">3.6 ms</span> | <span style="color:#666">17.1 ms</span> | <span style="color:green">4.8× faster</span>    |
| C — all-fields 'jo' (~20k hits, fewer trigrams)               | <span style="color:green">4.2 ms</span> | <span style="color:#666">17.9 ms</span> | <span style="color:green">4.3× faster</span>    |
| D — all-fields 'san antonio' (~10k hits, highly selective)    | <span style="color:green">4 ms</span>   | <span style="color:#666">16.1 ms</span> | <span style="color:green">4.0× faster</span>    |
| E — two-step 'jo'→'john' (filterByPreviousResult)             | <span style="color:green">7.3 ms</span> | <span style="color:#666">21.6 ms</span> | <span style="color:green">3.0× faster</span>    |
| E-step2 — pre-warmed step 2 only (narrow vs re-filter subset) | <span style="color:green">2.6 ms</span> | <span style="color:#666">3.6 ms</span>  | <span style="color:green">1.4× faster</span>    |
| F — non-indexed linear fallback (parity check)                | <span style="color:green">4.2 ms</span> | <span style="color:#666">17 ms</span>   | <span style="color:green">4.0× faster</span>    |
| G — absent long query, worst-case scan                        | <span style="color:green">0 ms</span>   | <span style="color:#666">11.5 ms</span> | <span style="color:green">∞× (cache hit)</span> |

### Per-scenario tail latency (p95 / p99 / max)

| Scenario                                                                          | p50                                     | p95     | p99     | Max     |
| --------------------------------------------------------------------------------- | --------------------------------------- | ------- | ------- | ------- |
| TextSearchEngine - indexed single-field (name, query: 'john')                     | <span style="color:green">1.6 ms</span> | 1.9 ms  | 1.9 ms  | 1.9 ms  |
| Native Array.filter - single-field (name.toLowerCase includes 'john')             | <span style="color:#666">6.1 ms</span>  | 8.5 ms  | 8.5 ms  | 8.5 ms  |
| TextSearchEngine - indexed all-fields (query: 'john')                             | <span style="color:green">3.6 ms</span> | 5.8 ms  | 5.8 ms  | 5.8 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'john')        | <span style="color:#666">17.1 ms</span> | 19.1 ms | 19.1 ms | 19.1 ms |
| TextSearchEngine - indexed all-fields (query: 'jo')                               | <span style="color:green">4.2 ms</span> | 8.6 ms  | 8.6 ms  | 8.6 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'jo')          | <span style="color:#666">17.9 ms</span> | 20.1 ms | 20.1 ms | 20.1 ms |
| TextSearchEngine - indexed all-fields (query: 'san antonio')                      | <span style="color:green">4 ms</span>   | 23.2 ms | 23.2 ms | 23.2 ms |
| Native Array.filter - all-fields (every field.toLowerCase includes 'san antonio') | <span style="color:#666">16.1 ms</span> | 18.9 ms | 18.9 ms | 18.9 ms |
| TextSearchEngine - filterByPreviousResult two-step search ('jo' → 'john')         | <span style="color:green">7.3 ms</span> | 14.1 ms | 14.1 ms | 14.1 ms |
| Native two-step: nativeAllFields('jo') then re-filter result for 'john'           | <span style="color:#666">21.6 ms</span> | 30.4 ms | 30.4 ms | 30.4 ms |
| TextSearchEngine - step 2 only (pre-warmed 'jo' intermediate)                     | <span style="color:green">2.6 ms</span> | 4.1 ms  | 4.1 ms  | 4.1 ms  |
| Baseline step 2 only - linear re-filter over pre-warmed 'jo' subset               | <span style="color:#666">3.6 ms</span>  | 5.6 ms  | 5.6 ms  | 5.6 ms  |
| TextSearchEngine - non-indexed linear fallback (query: 'john')                    | <span style="color:green">4.2 ms</span> | 9.4 ms  | 9.4 ms  | 9.4 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'john')        | <span style="color:#666">17 ms</span>   | 19.7 ms | 19.7 ms | 19.7 ms |
| TextSearchEngine - indexed all-fields worst-case absent long query                | <span style="color:green">0 ms</span>   | 0.1 ms  | 0.1 ms  | 0.1 ms  |
| Native Array.filter - all-fields worst-case absent long query                     | <span style="color:#666">11.5 ms</span> | 14 ms   | 14 ms   | 14 ms   |

---

## FilterEngine

These benchmarks compare `FilterEngine` against a baseline native `Array.filter` approach. The key metric is how fast the engine returns results when reusing cached index lookups (common in repeated or session-based queries).

### Summary

| Scenario                                    | FilterEngine p50                        | Native p50                              | Speedup                                       |
| ------------------------------------------- | --------------------------------------- | --------------------------------------- | --------------------------------------------- |
| A — single-call overhead                    | <span style="color:green">0.2 ms</span> | <span style="color:#666">1.7 ms</span>  | <span style="color:green">8.5× faster</span>  |
| B — 5 repeated queries                      | <span style="color:green">1.7 ms</span> | <span style="color:#666">7.8 ms</span>  | <span style="color:green">4.6× faster</span>  |
| C — 20 repeated queries                     | <span style="color:green">1.8 ms</span> | <span style="color:#666">29.1 ms</span> | <span style="color:green">16.2× faster</span> |
| D — 30-query session (2 criteria, 3 phases) | <span style="color:green">2.3 ms</span> | <span style="color:#666">81.3 ms</span> | <span style="color:green">35.3× faster</span> |

### Per-scenario tail latency (p95 / p99 / max)

| Scenario                                                              | p50                                     | p95      | p99      | Max      |
| --------------------------------------------------------------------- | --------------------------------------- | -------- | -------- | -------- |
| Native Array.filter — single-field equality (100k scanned, baseline)  | <span style="color:#666">1.7 ms</span>  | 4.4 ms   | 4.4 ms   | 4.4 ms   |
| FilterEngine indexed — single-field (1 compute, result cached)        | <span style="color:green">0.2 ms</span> | 0.5 ms   | 0.5 ms   | 0.5 ms   |
| Native × 5 — 5 identical filters, no cache (5 × 100k scans)           | <span style="color:#666">7.8 ms</span>  | 12.4 ms  | 12.4 ms  | 12.4 ms  |
| FilterEngine × 5 — 5 identical filters: 1 compute + 4 cache hits      | <span style="color:green">1.7 ms</span> | 4.6 ms   | 4.6 ms   | 4.6 ms   |
| Native × 20 — 20 identical filters, no cache (20 × 100k scans)        | <span style="color:#666">29.1 ms</span> | 49.6 ms  | 49.6 ms  | 49.6 ms  |
| FilterEngine × 20 — 20 identical filters: 1 compute + 19 cache hits   | <span style="color:green">1.8 ms</span> | 7.9 ms   | 7.9 ms   | 7.9 ms   |
| Native session × 30 — 3 criteria phases × 10 queries each (30 × 100k) | <span style="color:#666">81.3 ms</span> | 110.4 ms | 110.4 ms | 110.4 ms |
| FilterEngine session × 30 — 2 computes + 28 cache hits (map persists) | <span style="color:green">2.3 ms</span> | 5 ms     | 5 ms     | 5 ms     |

---

## SortEngine

Benchmarks below compare `SortEngine` to the baseline `Array.sort` implementation. The reported **p50** is the median latency across all runs. The engine is especially faster for indexed sorts where the sort order is pre-computed.

### Summary

| Scenario                                            | SortEngine p50                          | Native p50                              | Speedup                                       |
| --------------------------------------------------- | --------------------------------------- | --------------------------------------- | --------------------------------------------- |
| 1. SortEngine - indexed numeric (asc)               | <span style="color:green">0.9 ms</span> | <span style="color:#666">45.9 ms</span> | <span style="color:green">51.0× faster</span> |
| 2. SortEngine - indexed numeric (desc)              | <span style="color:green">0.9 ms</span> | <span style="color:#666">45.9 ms</span> | <span style="color:green">51.0× faster</span> |
| 3. SortEngine - non-indexed numeric                 | <span style="color:green">6.1 ms</span> | <span style="color:#666">45.9 ms</span> | <span style="color:green">7.5× faster</span>  |
| 4. SortEngine - multi-field (value asc, score desc) | <span style="color:green">6.6 ms</span> | <span style="color:#666">45.9 ms</span> | <span style="color:green">7.0× faster</span>  |
| 5. SortEngine - indexed string (label asc)          | <span style="color:green">0.9 ms</span> | <span style="color:#666">45.9 ms</span> | <span style="color:green">51.0× faster</span> |
| 6. SortEngine - ad-hoc external sort (value asc)    | <span style="color:green">6 ms</span>   | <span style="color:#666">45.9 ms</span> | <span style="color:green">7.6× faster</span>  |

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
