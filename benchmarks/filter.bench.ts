/// <reference types="node" />

import { FilterEngine } from "../src/filter/filter";
import type { FilterCriterion } from "../src/types";
import {
  heapMB,
  LatencyTableRow,
  MEASURE_RUNS,
  N,
  percentile,
  printBenchHeader,
  printComparisonTable,
  printLatencyTable,
  speedupStr,
  TableRow,
  WARMUP_RUNS,
} from "./utils";

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
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  memory_mb: number;
  status: "PASS" | "FAIL";
  failed_metrics: string[];
}

function generateDataset(): Item[] {
  const data: Item[] = new Array(N);
  for (let i = 0; i < N; i++) {
    data[i] = {
      id: i,
      status: STATUSES[i % 5],
      category: CATEGORIES[i % 4],
      region: REGIONS[i % 3],
      score: (i * 17 + ((i / 3) | 0) * 31) % 1000,
      active: i % 7 !== 0,
    };
  }
  return data;
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
  const p50_ms = round(percentile(times, 50));
  const p95_ms = round(percentile(times, 95));
  const p99_ms = round(percentile(times, 99));
  const max_ms = round(times[MEASURE_RUNS - 1]);

  const failed: string[] = [];
  if (p50_ms > THRESHOLDS.time_ms) failed.push("p50_ms");
  if (memory_mb > THRESHOLDS.memory_mb) failed.push("memory_mb");

  return {
    scenario,
    result_count,
    min_ms,
    p50_ms,
    p95_ms,
    p99_ms,
    max_ms,
    memory_mb,
    status: failed.length === 0 ? "PASS" : "FAIL",
    failed_metrics: failed,
  };
}

function run<T>(scenario: string, fn: () => T[]): ScenarioResult {
  return runWithSetup(scenario, () => {}, fn);
}

async function main(): Promise<void> {
  printBenchHeader("filter-bench", {
    metricsLabel:
      "p50 / p95 / p99 latency across all iterations (lower is better)",
  });
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
  const e_excludeIds = [300, 133, 56, 2, 200] as const;
  const e_excludeCriteria: FilterCriterion<Item>[] = [
    { field: "id", exclude: [...e_excludeIds] },
  ];
  const e_excludeNative = (item: Item): boolean =>
    !e_excludeIds.includes(item.id as (typeof e_excludeIds)[number]);

  const e1 = run(
    "[E1] Native exclude filter — single-field exclusion (100k scanned)",
    () => dataset.filter(e_excludeNative),
  );

  const e2 = runWithSetup(
    "[E2] FilterEngine exclude — single-field exclusion (cached)",
    () => engine.resetFilterState(),
    () => engine.filter(e_excludeCriteria),
  );

  const results = [a1, a2, b1, b2, c1, c2, d1, d2, e1, e2];

  const comparisonRows: TableRow[] = [
    {
      label: "A — single-call overhead",
      engineMs: a2.p50_ms,
      nativeMs: a1.p50_ms,
      speedup: speedupStr(a1.p50_ms, a2.p50_ms),
    },
    {
      label: "B — 5 repeated queries",
      engineMs: b2.p50_ms,
      nativeMs: b1.p50_ms,
      speedup: speedupStr(b1.p50_ms, b2.p50_ms),
    },
    {
      label: "C — 20 repeated queries",
      engineMs: c2.p50_ms,
      nativeMs: c1.p50_ms,
      speedup: speedupStr(c1.p50_ms, c2.p50_ms),
    },
    {
      label: "D — 30-query session (2 criteria, 3 phases)",
      engineMs: d2.p50_ms,
      nativeMs: d1.p50_ms,
      speedup: speedupStr(d1.p50_ms, d2.p50_ms),
    },
    {
      label: "E — exclude filter (ids not in set)",
      engineMs: e2.p50_ms,
      nativeMs: e1.p50_ms,
      speedup: speedupStr(e1.p50_ms, e2.p50_ms),
    },
  ];

  printComparisonTable(
    "FilterEngine vs Native — Performance Comparison (100k items)",
    comparisonRows,
  );

  printLatencyTable(
    "Per-scenario tail latency",
    results.map(
      (r): LatencyTableRow => ({
        scenario: r.scenario,
        p50_ms: r.p50_ms,
        p95_ms: r.p95_ms,
        p99_ms: r.p99_ms,
        max_ms: r.max_ms,
      }),
    ),
  );

  const failed = results
    .filter((r) => r.status === "FAIL")
    .map((r) => r.scenario);
  if (failed.length === 0) {
    console.log("\n✅  All FilterEngine scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failed.join(" | ")}`);
    process.exitCode = 1;
  }
}

main().catch(console.error);
