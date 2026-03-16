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

/// <reference types="node" />

import { FilterEngine } from "../src/filter/filter";
import type { FilterCriterion } from "../src/types";
import { CLR, MEASURE_RUNS, N, printBenchHeader, WARMUP_RUNS } from "./utils";

interface Item {
  id: number;
  status: string;
  category: string;
  region: string;
  score: number;
  active: boolean;
}

const THRESHOLDS = {
  time_ms: 150,
  memory_mb: 25,
} as const;

const STATUSES = ["pending", "active", "closed", "archived", "review"];
const CATEGORIES = ["A", "B", "C", "D"];
const REGIONS = ["north", "south", "east"];

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

interface TableRow {
  label: string;
  engineMs: number;
  nativeMs: number;
  speedup: string;
}

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

function heapMB(): number {
  return process.memoryUsage().heapUsed / 1_048_576;
}

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

function printComparisonTable(title: string, rows: TableRow[]): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const trunc = (s: string, n: number) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  const colLabel = Math.min(
    48,
    Math.max(44, ...rows.map((r) => r.label.length + 2)),
  );
  const colMs = 12;
  const colSpeedup = 18;
  const total = colLabel + colMs * 2 + colSpeedup + 4;

  const bar = "═".repeat(total);
  const sep = "─".repeat(total);
  const h = (s: string) => `${CLR.bold}${CLR.cyan}${s}${CLR.reset}`;

  console.log(`${h(bar)}`);
  console.log(h(`  ${title}`));
  console.log(h(bar));
  console.log(
    `${CLR.bold}  ${pad("Group / Scenario", colLabel)}${pad("Engine p50", colMs)}${pad("Native p50", colMs)}Speedup${CLR.reset}`,
  );
  console.log(sep);

  for (const row of rows) {
    const faster = row.engineMs <= row.nativeMs;
    const eColor = faster ? CLR.green : CLR.red;
    const nColor = faster ? CLR.dim : CLR.green;
    const sColor = faster ? CLR.green : CLR.red;
    const lbl = trunc(row.label, colLabel);

    console.log(
      `  ${pad(lbl, colLabel)}` +
        `${eColor}${pad(row.engineMs + " ms", colMs)}${CLR.reset}` +
        `${nColor}${pad(row.nativeMs + " ms", colMs)}${CLR.reset}` +
        `${sColor}${row.speedup}${CLR.reset}`,
    );
  }

  console.log(h(bar));
}

async function main(): Promise<void> {
  printBenchHeader("filter-bench");
  const dataset = generateDataset();

  const engine = new FilterEngine<Item>({
    data: dataset,
    fields: ["status", "category", "region"],
    filterByPreviousResult: true,
  });

  const a_criteria: FilterCriterion<Item>[] = [
    { field: "status", values: ["active"] },
  ];

  const bc_criteria: FilterCriterion<Item>[] = [
    { field: "status", values: ["active", "pending"] },
    { field: "region", values: ["north"] },
  ];
  const bc_nativeMatch = (item: Item): boolean =>
    (item.status === "active" || item.status === "pending") &&
    item.region === "north";

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

  const a1 = run(
    "[A1] Native Array.filter  — single-field equality (100k scanned, baseline)",
    () => dataset.filter((item) => item.status === "active"),
  );
  const a2 = runWithSetup(
    "[A2] FilterEngine indexed  — single-field (1 compute, result cached)",
    () => engine.resetFilterState(),
    () => engine.filter(a_criteria),
  );

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

  const d1 = run(
    "[D1] Native session × 30  — 3 criteria phases × 10 queries each (30 × 100k)",
    () => {
      for (let i = 0; i < 10; i++) dataset.filter(d_broadNative);
      for (let i = 0; i < 10; i++) dataset.filter(d_narrowNative);
      for (let i = 0; i < 9; i++) dataset.filter(d_broadNative);
      return dataset.filter(d_broadNative);
    },
  );
  const d2 = runWithSetup(
    "[D2] FilterEngine session × 30 — 2 computes + 28 cache hits (map persists)",
    () => engine.resetFilterState(),
    () => {
      for (let i = 0; i < 10; i++) engine.filter(d_broad);
      for (let i = 0; i < 10; i++) engine.filter(d_narrow);
      for (let i = 0; i < 9; i++) engine.filter(d_broad);
      return engine.filter(d_broad);
    },
  );

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

  printComparisonTable(
    "FilterEngine vs Native — Performance Comparison (100k items)",
    comparison_summary.map((r) => ({
      label: r.group,
      engineMs: r.engine_p50_ms,
      nativeMs: r.native_p50_ms,
      speedup: r.speedup,
    })),
  );

  if (report.overall_status === "PASS") {
    console.log("\n✅  All FilterEngine scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failedScenarios.join(" | ")}`);
  }
}

main().catch(console.error);
