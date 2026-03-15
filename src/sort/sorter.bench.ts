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
 * Metrics    : execution time (ms) · memory delta (MB)
 * Thresholds : time <= 150 ms · memory <= 25 MB
 *
 * Run with:  npx tsx src/sort/sorter.bench.ts
 */

import { SortEngine } from "./sorter";
import type { SortDescriptor } from "../types";

/* -- Dataset type --------------------------------------------------------------- */
interface Item {
  id: number;
  value: number;
  score: number;
  label: string;
}

/* -- Constants ------------------------------------------------------------------ */
const N = 100_000;

const THRESHOLDS = {
  time_ms: 150,
  memory_mb: 25,
} as const;

/* -- Dataset generator --------------------------------------------------------- */
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

/* -- Result types --------------------------------------------------------------- */
interface ScenarioResult {
  scenario: string;
  time_ms: number;
  memory_mb: number;
  sorted_sample: unknown[];
  status: "PASS" | "FAIL";
  failed_metrics: string[];
}

interface BenchReport {
  dataset_size: number;
  results: ScenarioResult[];
  failed_scenarios: string[];
  overall_status: "PASS" | "FAIL";
}

/* -- Measurement helper --------------------------------------------------------- */
function heapMB(): number {
  return process.memoryUsage().heapUsed / 1_048_576;
}

function run<T>(
  scenario: string,
  sampleFn: (result: T[]) => unknown[],
  fn: () => T[],
): ScenarioResult {
  const memBefore = heapMB();
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  const memAfter = heapMB();

  const time_ms = Math.round((t1 - t0) * 10) / 10;
  const memory_mb = Math.round(Math.max(0, memAfter - memBefore) * 100) / 100;

  const failed: string[] = [];
  if (time_ms > THRESHOLDS.time_ms) failed.push("time_ms");
  if (memory_mb > THRESHOLDS.memory_mb) failed.push("memory_mb");

  return {
    scenario,
    time_ms,
    memory_mb,
    sorted_sample: sampleFn(result),
    status: failed.length === 0 ? "PASS" : "FAIL",
    failed_metrics: failed,
  };
}

/* -- Main ----------------------------------------------------------------------- */
async function main(): Promise<void> {
  console.log(`\n=== SortEngine Benchmark  n=${N.toLocaleString()} ===`);
  console.log(
    `Thresholds: time <= ${THRESHOLDS.time_ms} ms | memory <= ${THRESHOLDS.memory_mb} MB\n`,
  );

  const dataset = generateDataset();

  /*
   * Engines created once — index-build cost is intentionally excluded from
   * sort-scenario measurements so we benchmark only the sort() call itself.
   */
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
    /* 1 -- Indexed numeric, ascending */
    run("1. SortEngine - indexed numeric (asc)", sampleValue, () =>
      indexedEngine.sort(ascByValue),
    ),
    /* 2 -- Indexed numeric, descending (same index, reversed traversal) */
    run("2. SortEngine - indexed numeric (desc)", sampleValue, () =>
      indexedEngine.sort(descByValue),
    ),
    /* 3 -- No pre-built index, falls back to sortNumericFastPath */
    run("3. SortEngine - non-indexed numeric", sampleValue, () =>
      noIndexEngine.sort(ascByValue),
    ),
    /* 4 -- Multi-field: indexed primary + secondary tiebreak */
    run(
      "4. SortEngine - multi-field (value asc, score desc)",
      sampleValue,
      () => indexedEngine.sort(multiField),
    ),
    /* 5 -- Indexed string sort */
    run("5. SortEngine - indexed string (label asc)", sampleLabel, () =>
      indexedEngine.sort(ascByLabel),
    ),
    /* 6 -- Ad-hoc: external array, no stored dataset */
    run("6. SortEngine - ad-hoc external sort (value asc)", sampleValue, () => {
      const adHoc = new SortEngine<Item>();
      return adHoc.sort(dataset, ascByValue);
    }),
    /* 7 -- Native baseline */
    run("7. Native Array.sort (value asc, baseline)", sampleValue, () =>
      dataset.slice().sort((a, b) => a.value - b.value),
    ),
  ];

  const failedScenarios = results
    .filter((r) => r.status === "FAIL")
    .map((r) => r.scenario);

  const report: BenchReport = {
    dataset_size: N,
    results,
    failed_scenarios: failedScenarios,
    overall_status: failedScenarios.length === 0 ? "PASS" : "FAIL",
  };

  console.log(JSON.stringify(report, null, 2));

  if (report.overall_status === "PASS") {
    console.log("\n✅  All SortEngine scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failedScenarios.join(" | ")}`);
  }
}

main().catch(console.error);
