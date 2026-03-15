/**
 * FilterEngine Performance Benchmark — 100 000-element dataset
 *
 * Honestly shows WHERE FilterEngine wins and WHERE it doesn't.
 * Each scenario is a native/engine pair so the comparison is direct.
 *
 * GROUP A — Per-call overhead context  (native is fast; engine is comparable)
 *   A1. Native Array.filter   single equality scan       (100k items)
 *   A2. FilterEngine indexed  same single-field filter   (index lookup)
 *
 * GROUP B — 5 repeated queries of same criteria  (cache starts paying)
 *   B1. Native: 5 × same filter from scratch             (5 × 100k scans)
 *   B2. Engine: 5 × same filter, filterByPreviousResult  (1 compute + 4 cache hits)
 *
 * GROUP C — 20 repeated queries of same criteria  (cache clearly wins)
 *   C1. Native: 20 × same filter from scratch            (20 × 100k scans)
 *   C2. Engine: 20 × same filter                         (1 compute + 19 cache hits)
 *
 * GROUP D — Realistic session: 3 criteria × 10 queries each
 *   User alternates between two filter states (broad ↔ narrow), then returns to
 *   the first state. Engine's per-criteria cache map remembers all seen results,
 *   so returning to a previous criteria state is always an instant cache hit.
 *   D1. Native: 30 fresh full-dataset scans  (3 criteria × 10 queries × 100k)
 *   D2. Engine: 2 actual computes + 28 cache hits  (map persists across backtracks)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Expected pattern from comparison_summary:
 *   A  ~1x  — per-call overhead is real; native and engine are roughly equal
 *   B  ~4x  — cache starts benefiting after the first "warm" query
 *   C  ~9x  — speedup grows linearly with the number of re-queries
 *   D  ~8x  — multi-criteria cache remembered across criteria changes
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Field independence: independent cycle lengths (5/4/3/7) give distinct distributions
 *   status   cycle-5  — 20k  items per value
 *   category cycle-4  — 25k  items per value
 *   region   cycle-3  — 33.3k items per value
 *   active   cycle-7  — 85.7k true / 14.3k false  (i % 7 !== 0)
 *
 * Metrics    : min_ms · p50_ms (median) · max_ms  across 5 measurement runs
 * Warm-up    : 3 un-timed runs per scenario to saturate V8 JIT
 * Thresholds : p50 <= 150 ms · memory <= 25 MB
 *
 * Run with:  npx tsx src/filter/filter.bench.ts
 * For GC isolation:  node --expose-gc -e "require('tsx').register()" src/filter/filter.bench.ts
 */

import { FilterEngine } from "./filter";
import type { FilterCriterion } from "../types";

/* -- Dataset type ---------------------------------------------------------------- */
interface Item {
  id: number;
  status: string; // cycle 5: [pending, active, closed, archived, review]
  category: string; // cycle 4: [A, B, C, D]
  region: string; // cycle 3: [north, south, east]
  score: number; // random 0–999
  active: boolean; // i % 7 !== 0  (cycle 7, independent of above)
}

/* -- Constants ------------------------------------------------------------------ */
const N = 100_000;
const WARMUP_RUNS = 3;
const MEASURE_RUNS = 5;

const THRESHOLDS = {
  time_ms: 150,
  memory_mb: 25,
} as const;

/* -- Value pools ---------------------------------------------------------------- */
const STATUSES = ["pending", "active", "closed", "archived", "review"]; // cycle 5
const CATEGORIES = ["A", "B", "C", "D"]; // cycle 4
const REGIONS = ["north", "south", "east"]; // cycle 3

/* -- Dataset generator ---------------------------------------------------------- */
function generateDataset(): Item[] {
  const data: Item[] = new Array(N);
  for (let i = 0; i < N; i++) {
    data[i] = {
      id: i,
      status: STATUSES[i % 5],
      category: CATEGORIES[i % 4],
      region: REGIONS[i % 3],
      score: (Math.random() * 1000) | 0,
      active: i % 7 !== 0,
    };
  }
  return data;
}

/* -- Result types --------------------------------------------------------------- */
interface ScenarioResult {
  scenario: string;
  result_count: number;
  min_ms: number;
  p50_ms: number;
  max_ms: number;
  memory_mb: number;
  status: "PASS" | "FAIL";
  failed_metrics: string[];
}

interface ComparisonRow {
  group: string;
  engine_p50_ms: number;
  native_p50_ms: number;
  speedup: string;
  note: string;
}

interface BenchReport {
  dataset_size: number;
  warmup_runs: number;
  measure_runs: number;
  results: ScenarioResult[];
  comparison_summary: ComparisonRow[];
  failed_scenarios: string[];
  overall_status: "PASS" | "FAIL";
}

/* -- Measurement helpers -------------------------------------------------------- */
function heapMB(): number {
  return process.memoryUsage().heapUsed / 1_048_576;
}

/**
 * Setup-isolated run: setup() is called before each fn() invocation
 * (warm-up and timed). Only fn() is measured. Use when engine state
 * must be reset before each timed call to isolate the desired path.
 */
function runWithSetup<T>(
  scenario: string,
  setup: () => void,
  fn: () => T[],
): ScenarioResult {
  const round = (v: number) => Math.round(v * 10) / 10;

  for (let w = 0; w < WARMUP_RUNS; w++) {
    setup();
    fn();
  }
  globalThis.gc?.();

  setup();
  const memBefore = heapMB();
  const memResult = fn();
  const memAfter = heapMB();
  const memory_mb = Math.round(Math.max(0, memAfter - memBefore) * 100) / 100;
  const result_count = memResult.length;
  globalThis.gc?.();

  const times: number[] = [];
  for (let r = 0; r < MEASURE_RUNS; r++) {
    setup();
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  const min_ms = round(times[0]);
  const p50_ms = round(times[Math.floor(MEASURE_RUNS / 2)]);
  const max_ms = round(times[MEASURE_RUNS - 1]);

  const failed: string[] = [];
  if (p50_ms > THRESHOLDS.time_ms) failed.push("p50_ms");
  if (memory_mb > THRESHOLDS.memory_mb) failed.push("memory_mb");

  return {
    scenario,
    result_count,
    min_ms,
    p50_ms,
    max_ms,
    memory_mb,
    status: failed.length === 0 ? "PASS" : "FAIL",
    failed_metrics: failed,
  };
}

/** Standard run — no setup required; fn() is self-contained. */
function run<T>(scenario: string, fn: () => T[]): ScenarioResult {
  return runWithSetup(scenario, () => {}, fn);
}

function speedupStr(nativeP50: number, engineP50: number): string {
  if (engineP50 <= 0) return "∞x (cache hit)";
  const ratio = nativeP50 / engineP50;
  return ratio >= 1
    ? `${ratio.toFixed(1)}x faster`
    : `${(1 / ratio).toFixed(1)}x slower`;
}

/* -- Main ----------------------------------------------------------------------- */
async function main(): Promise<void> {
  console.log(`\n=== FilterEngine Benchmark  n=${N.toLocaleString()} ===`);
  console.log(
    `Thresholds: time <= ${THRESHOLDS.time_ms} ms | memory <= ${THRESHOLDS.memory_mb} MB\n`,
  );

  const dataset = generateDataset();

  /*
   * Engine created once; index-build cost is excluded from all scenario
   * measurements — we only benchmark the filter() call itself.
   */
  const engine = new FilterEngine<Item>({
    data: dataset,
    fields: ["status", "category", "region"],
    filterByPreviousResult: true,
  });

  /* ── Criteria ────────────────────────────────────────────────────────────── */

  // GROUP A: single equality match — status="active" → 20k items  (i%5 === 1)
  const a_criteria: FilterCriterion<Item>[] = [
    { field: "status", values: ["active"] },
  ];

  // GROUPS B/C: 2-field match — status in [active,pending] AND region="north"
  //   → 13 333 items  (i%15 ∈ {0, 6})
  const bc_criteria: FilterCriterion<Item>[] = [
    { field: "status", values: ["active", "pending"] },
    { field: "region", values: ["north"] },
  ];
  const bc_nativeMatch = (item: Item): boolean =>
    (item.status === "active" || item.status === "pending") &&
    item.region === "north";

  // GROUP D criteria pair — broad / narrow (narrow is a subset of broad):
  //   broad:  status in [active, pending, review] → 60 000 items  (i%5 ∈ {0,1,4})
  //   narrow: status in [active, pending]         → 40 000 items  (i%5 ∈ {0,1})
  //
  // Narrow → broad triggers a hasCriteriaBacktrack (values expand → NOT a
  // subset → engine recalculates from baseData).  After the recalc the broad
  // results is stored in previousResultsByCriteria.  When we flip back to
  // narrow the engine finds the stored result instantly (cache hit).
  const d_broad: FilterCriterion<Item>[] = [
    { field: "status", values: ["active", "pending", "review"] },
  ];
  const d_narrow: FilterCriterion<Item>[] = [
    { field: "status", values: ["active", "pending"] },
  ];
  const d_broadNative = (item: Item): boolean =>
    item.status === "active" ||
    item.status === "pending" ||
    item.status === "review";
  const d_narrowNative = (item: Item): boolean =>
    item.status === "active" || item.status === "pending";

  /* ── GROUP A ─────────────────────────────────────────────────────────────── */
  const a1 = run(
    "[A1] Native Array.filter  — single-field equality (100k scanned, baseline)",
    () => dataset.filter((item) => item.status === "active"),
  );
  const a2 = runWithSetup(
    "[A2] FilterEngine indexed  — single-field (1 compute, result cached)",
    () => engine.resetFilterState(),
    () => engine.filter(a_criteria),
  );

  /* ── GROUP B: 5 repeated queries ─────────────────────────────────────────── */
  const b1 = run(
    "[B1] Native × 5           — 5 identical filters, no cache (5 × 100k scans)",
    () => {
      for (let i = 0; i < 4; i++) dataset.filter(bc_nativeMatch);
      return dataset.filter(bc_nativeMatch);
    },
  );
  const b2 = runWithSetup(
    "[B2] FilterEngine × 5     — 5 identical filters: 1 compute + 4 cache hits",
    () => engine.resetFilterState(),
    () => {
      for (let i = 0; i < 4; i++) engine.filter(bc_criteria);
      return engine.filter(bc_criteria);
    },
  );

  /* ── GROUP C: 20 repeated queries ────────────────────────────────────────── */
  const c1 = run(
    "[C1] Native × 20          — 20 identical filters, no cache (20 × 100k scans)",
    () => {
      for (let i = 0; i < 19; i++) dataset.filter(bc_nativeMatch);
      return dataset.filter(bc_nativeMatch);
    },
  );
  const c2 = runWithSetup(
    "[C2] FilterEngine × 20    — 20 identical filters: 1 compute + 19 cache hits",
    () => engine.resetFilterState(),
    () => {
      for (let i = 0; i < 19; i++) engine.filter(bc_criteria);
      return engine.filter(bc_criteria);
    },
  );

  /* ── GROUP D: realistic session — broad ↔ narrow × 10 each ──────────────── */
  //
  // Session layout (30 total queries, no resetFilterState between them):
  //   Phase 1 — 10 × broad criteria:  first call computes, 9 are cache hits
  //   Phase 2 — 10 × narrow criteria: first call computes (backtrack), 9 cache hits
  //   Phase 3 — 10 × broad criteria:  ALL 10 are cache hits (map remembers Phase 1!)
  //
  // Engine total: 2 computes + 28 cache hits.
  // Native total: 30 fresh full-dataset scans.
  const d1 = run(
    "[D1] Native session × 30  — 3 criteria phases × 10 queries each (30 × 100k)",
    () => {
      // Phase 1
      for (let i = 0; i < 10; i++) dataset.filter(d_broadNative);
      // Phase 2
      for (let i = 0; i < 10; i++) dataset.filter(d_narrowNative);
      // Phase 3 — same as phase 1, native has no cache
      for (let i = 0; i < 9; i++) dataset.filter(d_broadNative);
      return dataset.filter(d_broadNative);
    },
  );
  const d2 = runWithSetup(
    "[D2] FilterEngine session × 30 — 2 computes + 28 cache hits (map persists)",
    () => engine.resetFilterState(),
    () => {
      // Phase 1: computes broad on first call, then cache
      for (let i = 0; i < 10; i++) engine.filter(d_broad);
      // Phase 2: backtrack → recalc narrow, then cache
      for (let i = 0; i < 10; i++) engine.filter(d_narrow);
      // Phase 3: broad result still in previousResultsByCriteria map → all cache
      for (let i = 0; i < 9; i++) engine.filter(d_broad);
      return engine.filter(d_broad);
    },
  );

  /* ── Report ──────────────────────────────────────────────────────────────── */
  const results = [a1, a2, b1, b2, c1, c2, d1, d2];

  const comparison_summary: ComparisonRow[] = [
    {
      group: "A — single-call overhead context",
      engine_p50_ms: a2.p50_ms,
      native_p50_ms: a1.p50_ms,
      speedup: speedupStr(a1.p50_ms, a2.p50_ms),
      note: "Per-call cost is similar; engine index overhead disclosed honestly",
    },
    {
      group: "B — 5 repeated queries",
      engine_p50_ms: b2.p50_ms,
      native_p50_ms: b1.p50_ms,
      speedup: speedupStr(b1.p50_ms, b2.p50_ms),
      note: "Engine wins: 1 compute + 4 O(1) cache hits vs 5 full scans",
    },
    {
      group: "C — 20 repeated queries",
      engine_p50_ms: c2.p50_ms,
      native_p50_ms: c1.p50_ms,
      speedup: speedupStr(c1.p50_ms, c2.p50_ms),
      note: "Engine wins: speedup grows linearly with repeat-query count",
    },
    {
      group: "D — 30-query session (2 criteria, 3 phases)",
      engine_p50_ms: d2.p50_ms,
      native_p50_ms: d1.p50_ms,
      speedup: speedupStr(d1.p50_ms, d2.p50_ms),
      note: "Engine wins: per-criteria cache map survives criteria changes",
    },
  ];

  const failedScenarios = results
    .filter((r) => r.status === "FAIL")
    .map((r) => r.scenario);

  const report: BenchReport = {
    dataset_size: N,
    warmup_runs: WARMUP_RUNS,
    measure_runs: MEASURE_RUNS,
    results,
    comparison_summary,
    failed_scenarios: failedScenarios,
    overall_status: failedScenarios.length === 0 ? "PASS" : "FAIL",
  };

  console.log(JSON.stringify(report, null, 2));

  if (report.overall_status === "PASS") {
    console.log("\n✅  All FilterEngine scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failedScenarios.join(" | ")}`);
  }
}

main().catch(console.error);
