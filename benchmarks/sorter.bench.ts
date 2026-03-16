/**
 * SortEngine Performance Benchmark — 100 000-element dataset
 *
 * Tests real SortEngine usage scenarios:
 *   1. Indexed numeric sort  (pre-built index, asc)
 *   2. Indexed numeric sort  (pre-built index, desc)
 *   3. Non-indexed numeric sort  (no index)
 *   4. Multi-field sort  (indexed primary + secondary)
 *   5. Indexed string sort
 *   6. Ad-hoc sort  (external data array, no stored dataset)
 *   7. Native Array.sort  (baseline)
 *
 * Metrics    : min_ms · p50_ms (median) · max_ms  across 5 measurement runs
 * Warm-up    : 3 un-timed runs per scenario to saturate V8 JIT before measuring
 * Thresholds : p50 <= 150 ms · memory <= 25 MB
 *
 * Run with:  npx tsx src/sort/sorter.bench.ts
 * For GC isolation between scenarios (more accurate memory):
 *   node --expose-gc -e "require('tsx').register()" src/sort/sorter.bench.ts
 */

/// <reference types="node" />
import { SortEngine } from "../src/sort/sorter";
import type { SortDescriptor } from "../src/types";
import { CLR, MEASURE_RUNS, N, printBenchHeader, WARMUP_RUNS } from "./utils";

interface Item {
  id: number;
  value: number;
  score: number;
  label: string;
}

const THRESHOLDS = {
  time_ms: 150,
  memory_mb: 25,
} as const;

interface ScenarioResult {
  scenario: string;
  min_ms: number;
  p50_ms: number;
  max_ms: number;
  memory_mb: number;
  sorted_sample: unknown[];
  status: "PASS" | "FAIL";
  failed_metrics: string[];
}

interface BenchReport {
  dataset_size: number;
  warmup_runs: number;
  measure_runs: number;
  results: ScenarioResult[];
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
      value: (Math.random() * 1_000_000) | 0,
      score: Math.round(Math.random() * 1000) / 10,
      label: `item-${String((Math.random() * 1_000_000) | 0).padStart(7, "0")}`,
    };
  }
  return data;
}

function heapMB(): number {
  return process.memoryUsage().heapUsed / 1_048_576;
}

function run<T>(
  scenario: string,
  sampleFn: (result: T[]) => unknown[],
  fn: () => T[],
): ScenarioResult {
  const round = (v: number) => Math.round(v * 10) / 10;

  for (let w = 0; w < WARMUP_RUNS; w++) fn();
  globalThis.gc?.();

  const memBefore = heapMB();
  const memResult = fn();
  const memAfter = heapMB();
  const memory_mb = Math.round(Math.max(0, memAfter - memBefore) * 100) / 100;
  const sorted_sample = sampleFn(memResult);
  globalThis.gc?.();

  const times: number[] = [];
  for (let r = 0; r < MEASURE_RUNS; r++) {
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
    min_ms,
    p50_ms,
    max_ms,
    memory_mb,
    sorted_sample,
    status: failed.length === 0 ? "PASS" : "FAIL",
    failed_metrics: failed,
  };
}

function speedupSort(nativeMs: number, engineMs: number): string {
  if (engineMs <= 0) return "N/A";
  const ratio = nativeMs / engineMs;
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
    `${CLR.bold}  ${pad("Scenario", colLabel)}${pad("Engine p50", colMs)}${pad("Native p50", colMs)}Speedup${CLR.reset}`,
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
  printBenchHeader("sort-bench");
  const dataset = generateDataset();

  const indexedEngine = new SortEngine<Item>({
    data: dataset,
    fields: ["value", "score", "label"],
  });

  const noIndexEngine = new SortEngine<Item>({ data: dataset });

  const ascByValue: SortDescriptor<Item>[] = [
    { field: "value", direction: "asc" },
  ];
  const descByValue: SortDescriptor<Item>[] = [
    { field: "value", direction: "desc" },
  ];
  const ascByLabel: SortDescriptor<Item>[] = [
    { field: "label", direction: "asc" },
  ];
  const multiField: SortDescriptor<Item>[] = [
    { field: "value", direction: "asc" },
    { field: "score", direction: "desc" },
  ];

  const sampleValue = (r: Item[]) => r.slice(0, 3).map((x) => x.value);
  const sampleLabel = (r: Item[]) => r.slice(0, 3).map((x) => x.label);

  const results: ScenarioResult[] = [
    run("1. SortEngine - indexed numeric (asc)", sampleValue, () =>
      indexedEngine.sort(ascByValue),
    ),
    run("2. SortEngine - indexed numeric (desc)", sampleValue, () =>
      indexedEngine.sort(descByValue),
    ),
    run("3. SortEngine - non-indexed numeric", sampleValue, () =>
      noIndexEngine.sort(ascByValue),
    ),
    run(
      "4. SortEngine - multi-field (value asc, score desc)",
      sampleValue,
      () => indexedEngine.sort(multiField),
    ),
    run("5. SortEngine - indexed string (label asc)", sampleLabel, () =>
      indexedEngine.sort(ascByLabel),
    ),
    run("6. SortEngine - ad-hoc external sort (value asc)", sampleValue, () => {
      const adHoc = new SortEngine<Item>();
      return adHoc.sort(dataset, ascByValue);
    }),
    run("7. Native Array.sort (value asc, baseline)", sampleValue, () =>
      dataset.slice().sort((a, b) => a.value - b.value),
    ),
  ];

  const failedScenarios = results
    .filter((r) => r.status === "FAIL")
    .map((r) => r.scenario);

  const report: BenchReport = {
    dataset_size: N,
    warmup_runs: WARMUP_RUNS,
    measure_runs: MEASURE_RUNS,
    results,
    failed_scenarios: failedScenarios,
    overall_status: failedScenarios.length === 0 ? "PASS" : "FAIL",
  };

  const nativeBaseline = results[6].p50_ms;
  const sortComparison: TableRow[] = [
    {
      label: "1. Indexed numeric  (asc)",
      engineMs: results[0].p50_ms,
      nativeMs: nativeBaseline,
      speedup: speedupSort(nativeBaseline, results[0].p50_ms),
    },
    {
      label: "2. Indexed numeric  (desc)",
      engineMs: results[1].p50_ms,
      nativeMs: nativeBaseline,
      speedup: speedupSort(nativeBaseline, results[1].p50_ms),
    },
    {
      label: "3. Non-indexed numeric",
      engineMs: results[2].p50_ms,
      nativeMs: nativeBaseline,
      speedup: speedupSort(nativeBaseline, results[2].p50_ms),
    },
    {
      label: "4. Multi-field  (value asc + score desc)",
      engineMs: results[3].p50_ms,
      nativeMs: nativeBaseline,
      speedup: speedupSort(nativeBaseline, results[3].p50_ms),
    },
    {
      label: "5. Indexed string  (label asc)",
      engineMs: results[4].p50_ms,
      nativeMs: nativeBaseline,
      speedup: speedupSort(nativeBaseline, results[4].p50_ms),
    },
    {
      label: "6. Ad-hoc external sort",
      engineMs: results[5].p50_ms,
      nativeMs: nativeBaseline,
      speedup: speedupSort(nativeBaseline, results[5].p50_ms),
    },
  ];

  printComparisonTable(
    "SortEngine vs Native Array.sort — Performance Comparison (100k items)",
    sortComparison,
  );

  if (report.overall_status === "PASS") {
    console.log("\n✅  All SortEngine scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failedScenarios.join(" | ")}`);
  }
}

main().catch(console.error);
