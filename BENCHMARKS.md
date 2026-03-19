# Benchmarks

## Environment

These benchmarks were collected using the same environment information printed by each benchmark script.

```
Measured on  @devisfuture/mega-collection v2.4.8
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
| A — single-field 'john' (~10k hits)                           | <span style="color:green">1.7 ms</span> | <span style="color:#666">6.5 ms</span>  | <span style="color:green">3.8× faster</span>    |
| B — all-fields 'john' (~10k hits)                             | <span style="color:green">3.5 ms</span> | <span style="color:#666">17.2 ms</span> | <span style="color:green">4.9× faster</span>    |
| C — all-fields 'jo' (~20k hits, fewer trigrams)               | <span style="color:green">4.4 ms</span> | <span style="color:#666">18.1 ms</span> | <span style="color:green">4.1× faster</span>    |
| D — all-fields 'san antonio' (~10k hits, highly selective)    | <span style="color:green">4.5 ms</span> | <span style="color:#666">16.2 ms</span> | <span style="color:green">3.6× faster</span>    |
| E — two-step 'jo'→'john' (filterByPreviousResult)             | <span style="color:green">7.6 ms</span> | <span style="color:#666">21.7 ms</span> | <span style="color:green">2.9× faster</span>    |
| E-step2 — pre-warmed step 2 only (narrow vs re-filter subset) | <span style="color:green">2.4 ms</span> | <span style="color:#666">3.6 ms</span>  | <span style="color:green">1.5× faster</span>    |
| F — non-indexed linear fallback (parity check)                | <span style="color:green">4.6 ms</span> | <span style="color:#666">17 ms</span>   | <span style="color:green">3.7× faster</span>    |
| G — absent long query, worst-case scan                        | <span style="color:green">0 ms</span>   | <span style="color:#666">11.9 ms</span> | <span style="color:green">∞× (cache hit)</span> |

### Per-scenario tail latency (p95 / p99 / max)

| Scenario                                                                          | p50                                     | p95     | p99     | Max     |
| --------------------------------------------------------------------------------- | --------------------------------------- | ------- | ------- | ------- |
| TextSearchEngine - indexed single-field (name, query: 'john')                     | <span style="color:green">1.7 ms</span> | 2.4 ms  | 2.4 ms  | 2.4 ms  |
| Native Array.filter - single-field (name.toLowerCase includes 'john')             | <span style="color:#666">6.5 ms</span>  | 7.6 ms  | 7.6 ms  | 7.6 ms  |
| TextSearchEngine - indexed all-fields (query: 'john')                             | <span style="color:green">3.5 ms</span> | 4.9 ms  | 4.9 ms  | 4.9 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'john')        | <span style="color:#666">17.2 ms</span> | 19.2 ms | 19.2 ms | 19.2 ms |
| TextSearchEngine - indexed all-fields (query: 'jo')                               | <span style="color:green">4.4 ms</span> | 5.8 ms  | 5.8 ms  | 5.8 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'jo')          | <span style="color:#666">18.1 ms</span> | 18.4 ms | 18.4 ms | 18.4 ms |
| TextSearchEngine - indexed all-fields (query: 'san antonio')                      | <span style="color:green">4.5 ms</span> | 5.4 ms  | 5.4 ms  | 5.4 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'san antonio') | <span style="color:#666">16.2 ms</span> | 16.5 ms | 16.5 ms | 16.5 ms |
| TextSearchEngine - filterByPreviousResult two-step search ('jo' → 'john')         | <span style="color:green">7.6 ms</span> | 10.1 ms | 10.1 ms | 10.1 ms |
| Native two-step: nativeAllFields('jo') then re-filter result for 'john'           | <span style="color:#666">21.7 ms</span> | 23.9 ms | 23.9 ms | 23.9 ms |
| TextSearchEngine - step 2 only (pre-warmed 'jo' intermediate)                     | <span style="color:green">2.4 ms</span> | 3 ms    | 3 ms    | 3 ms    |
| Baseline step 2 only - linear re-filter over pre-warmed 'jo' subset               | <span style="color:#666">3.6 ms</span>  | 4.7 ms  | 4.7 ms  | 4.7 ms  |
| TextSearchEngine - non-indexed linear fallback (query: 'john')                    | <span style="color:green">4.6 ms</span> | 7.9 ms  | 7.9 ms  | 7.9 ms  |
| Native Array.filter - all-fields (every field.toLowerCase includes 'john')        | <span style="color:#666">17 ms</span>   | 17.6 ms | 17.6 ms | 17.6 ms |
| TextSearchEngine - indexed all-fields worst-case absent long query                | <span style="color:green">0 ms</span>   | 0.1 ms  | 0.1 ms  | 0.1 ms  |
| Native Array.filter - all-fields worst-case absent long query                     | <span style="color:#666">11.9 ms</span> | 12.9 ms | 12.9 ms | 12.9 ms |

---

## FilterEngine

These benchmarks compare `FilterEngine` against a baseline native `Array.filter` approach. The key metric is how fast the engine returns results when reusing cached index lookups (common in repeated or session-based queries).

### Summary

| Scenario                                    | FilterEngine p50                        | Native p50                              | Speedup                                         |
| ------------------------------------------- | --------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| A — single-call overhead                    | <span style="color:green">0 ms</span>   | <span style="color:#666">1.9 ms</span>  | <span style="color:green">∞× (cache hit)</span> |
| B — 5 repeated queries                      | <span style="color:green">0.1 ms</span> | <span style="color:#666">7.5 ms</span>  | <span style="color:green">75× faster</span>     |
| C — 20 repeated queries                     | <span style="color:green">0.2 ms</span> | <span style="color:#666">27.8 ms</span> | <span style="color:green">139× faster</span>    |
| D — 30-query session (2 criteria, 3 phases) | <span style="color:green">0.3 ms</span> | <span style="color:#666">80.9 ms</span> | <span style="color:green">270× faster</span>    |
| E — exclude filter (status not in set)      | <span style="color:green">0 ms</span>   | <span style="color:#666">3.1 ms</span>  | <span style="color:green">∞× (cache hit)</span> |

### Per-scenario tail latency (p95 / p99 / max)

| Scenario                                                              | p50                                     | p95     | p99     | Max     |
| --------------------------------------------------------------------- | --------------------------------------- | ------- | ------- | ------- |
| Native Array.filter — single-field equality (100k scanned, baseline)  | <span style="color:#666">1.9 ms</span>  | 2.1 ms  | 2.1 ms  | 2.1 ms  |
| FilterEngine indexed — single-field (1 compute, result cached)        | <span style="color:green">0 ms</span>   | 0.2 ms  | 0.2 ms  | 0.2 ms  |
| Native × 5 — 5 identical filters, no cache (5 × 100k scans)           | <span style="color:#666">9.3 ms</span>  | 11.3 ms | 11.3 ms | 11.3 ms |
| FilterEngine × 5 — 5 identical filters: 1 compute + 4 cache hits      | <span style="color:green">0.1 ms</span> | 0.1 ms  | 0.1 ms  | 0.1 ms  |
| Native × 20 — 20 identical filters, no cache (20 × 100k scans)        | <span style="color:#666">32 ms</span>   | 33.3 ms | 33.3 ms | 33.3 ms |
| FilterEngine × 20 — 20 identical filters: 1 compute + 19 cache hits   | <span style="color:green">0.2 ms</span> | 0.4 ms  | 0.4 ms  | 0.4 ms  |
| Native session × 30 — 3 criteria phases × 10 queries each (30 × 100k) | <span style="color:#666">80.9 ms</span> | 88.8 ms | 88.8 ms | 88.8 ms |
| FilterEngine session × 30 — 2 computes + 28 cache hits (map persists) | <span style="color:green">0.3 ms</span> | 0.5 ms  | 0.5 ms  | 0.5 ms  |
| [E1] Native exclude filter — single-field exclusion (100k scanned)    | 3.1 ms                                  | 4.9 ms  | 4.9 ms  | 4.9 ms  |
| [E2] FilterEngine exclude — single-field exclusion (cached)           | 0 ms                                    | 0 ms    | 0 ms    | 0 ms    |

---

## SortEngine

Benchmarks below compare `SortEngine` to the baseline `Array.sort` implementation. The reported **p50** is the median latency across all runs. The engine is especially faster for indexed sorts where the sort order is pre-computed.

### Summary

| Scenario                                            | SortEngine p50                          | Native p50                              | Speedup                                         |
| --------------------------------------------------- | --------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| 1. SortEngine - indexed numeric (asc)               | <span style="color:green">0 ms</span>   | <span style="color:#666">48.9 ms</span> | <span style="color:green">∞× (cache hit)</span> |
| 2. SortEngine - indexed numeric (desc)              | <span style="color:green">0 ms</span>   | <span style="color:#666">48.9 ms</span> | <span style="color:green">∞× (cache hit)</span> |
| 3. SortEngine - non-indexed numeric                 | <span style="color:green">6.3 ms</span> | <span style="color:#666">48.9 ms</span> | <span style="color:green">7.8× faster</span>    |
| 4. SortEngine - multi-field (value asc, score desc) | <span style="color:green">6.6 ms</span> | <span style="color:#666">48.9 ms</span> | <span style="color:green">7.4× faster</span>    |
| 5. SortEngine - indexed string (label asc)          | <span style="color:green">0 ms</span>   | <span style="color:#666">48.9 ms</span> | <span style="color:green">∞× (cache hit)</span> |
| 6. SortEngine - ad-hoc external sort (value asc)    | <span style="color:green">6.4 ms</span> | <span style="color:#666">48.9 ms</span> | <span style="color:green">7.6× faster</span>    |

### Per-scenario tail latency (p95 / p99 / max)

| Scenario                                         | p50     | p95     | p99     | Max     |
| ------------------------------------------------ | ------- | ------- | ------- | ------- |
| SortEngine - indexed numeric (asc)               | 0 ms    | 0.1 ms  | 0.1 ms  | 0.1 ms  |
| SortEngine - indexed numeric (desc)              | 0 ms    | 0 ms    | 0 ms    | 0 ms    |
| SortEngine - non-indexed numeric                 | 6.3 ms  | 13.1 ms | 13.1 ms | 13.1 ms |
| SortEngine - multi-field (value asc, score desc) | 6.6 ms  | 8.7 ms  | 8.7 ms  | 8.7 ms  |
| SortEngine - indexed string (label asc)          | 0 ms    | 0 ms    | 0 ms    | 0 ms    |
| SortEngine - ad-hoc external sort (value asc)    | 6.4 ms  | 8.1 ms  | 8.1 ms  | 8.1 ms  |
| Native Array.sort (value asc, baseline)          | 48.9 ms | 51.1 ms | 51.1 ms | 51.1 ms |

---

## MergeEngines controls add/update/delete

These benchmarks compare `MergeEngines` controls against a baseline native `Array`/`Map` approach. The key metric is how fast the engine can apply small mutations and then read back results (search/filter/sort) immediately.

### Summary

| Scenario                                             | Engine p50                                | Native p50                                | Speedup                                       |
| ---------------------------------------------------- | ----------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| A — add 5 items, then read once                      | <span style="color:green">3.64 ms</span>  | <span style="color:#666">116.69 ms</span> | <span style="color:green">32.1× faster</span> |
| B — update 1 item, then read once                    | <span style="color:green">24.35 ms</span> | <span style="color:#666">64.08 ms</span>  | <span style="color:green">2.6× faster</span>  |
| C — delete 5 ids via mutable exclude, then read once | <span style="color:green">28.2 ms</span>  | <span style="color:#666">57.13 ms</span>  | <span style="color:green">2.0× faster</span>  |

### Per-scenario tail latency (p95 / p99 / max)

| Scenario                                                                                       | p50                                       | p95                                       | p99                                       | Max                                       |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| A1. MergeEngines.add() append 5 items + immediate search/filter/sort read                      | <span style="color:green">3.64 ms</span>  | <span style="color:#666">6.93 ms</span>   | <span style="color:#666">6.93 ms</span>   | <span style="color:#666">6.93 ms</span>   |
| A2. Native Array/Map add – append 5 items + immediate linear search/filter/sort read           | <span style="color:#666">116.69 ms</span> | <span style="color:#666">180.55 ms</span> | <span style="color:#666">180.55 ms</span> | <span style="color:#666">180.55 ms</span> |
| B1. MergeEngines.update() refresh 1 item + immediate search/filter/sort read                   | <span style="color:green">24.35 ms</span> | <span style="color:#666">318.62 ms</span> | <span style="color:#666">318.62 ms</span> | <span style="color:#666">318.62 ms</span> |
| B2. Native Array/Map update – replace 1 item + immediate linear search/filter/sort read        | <span style="color:#666">64.08 ms</span>  | <span style="color:#666">116.25 ms</span> | <span style="color:#666">116.25 ms</span> | <span style="color:#666">116.25 ms</span> |
| C1. MergeEngines mutable exclude – remove 5 ids + immediate search/filter/sort read            | <span style="color:green">28.2 ms</span>  | <span style="color:#666">52.51 ms</span>  | <span style="color:#666">52.51 ms</span>  | <span style="color:#666">52.51 ms</span>  |
| C2. Native Array/Map swap-pop delete – remove 5 ids + immediate linear search/filter/sort read | <span style="color:#666">57.13 ms</span>  | <span style="color:#666">155.8 ms</span>  | <span style="color:#666">155.8 ms</span>  | <span style="color:#666">155.8 ms</span>  |
