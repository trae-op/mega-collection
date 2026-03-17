/// <reference types="node" />
import { SortEngine } from "../src/sort/sorter";
import type { SortDescriptor } from "../src/types";
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
      value: (Math.random() * 1_000_000) | 0,
      score: Math.round(Math.random() * 1000) / 10,
      label: `item-${String((Math.random() * 1_000_000) | 0).padStart(7, "0")}`,
    };
  }
  return data;
}

function run<T>(scenario: string, fn: () => T[]): ScenarioResult {
  const round = (v: number) => Math.round(v * 10) / 10;

  for (let w = 0; w < WARMUP_RUNS; w++) fn();
  globalThis.gc?.();

  const memBefore = heapMB();
  fn();
  const memAfter = heapMB();
  const memory_mb = Math.round(Math.max(0, memAfter - memBefore) * 100) / 100;
  globalThis.gc?.();

  const times: number[] = [];
  for (let r = 0; r < MEASURE_RUNS; r++) {
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

  const results: ScenarioResult[] = [
    run("1. SortEngine - indexed numeric (asc)", () =>
      indexedEngine.sort(ascByValue),
    ),
    run("2. SortEngine - indexed numeric (desc)", () =>
      indexedEngine.sort(descByValue),
    ),
    run("3. SortEngine - non-indexed numeric", () =>
      noIndexEngine.sort(ascByValue),
    ),
    run("4. SortEngine - multi-field (value asc, score desc)", () =>
      indexedEngine.sort(multiField),
    ),
    run("5. SortEngine - indexed string (label asc)", () =>
      indexedEngine.sort(ascByLabel),
    ),
    run("6. SortEngine - ad-hoc external sort (value asc)", () => {
      const adHoc = new SortEngine<Item>();
      return adHoc.sort(dataset, ascByValue);
    }),
    run("7. Native Array.sort (value asc, baseline)", () =>
      dataset.slice().sort((a, b) => a.value - b.value),
    ),
  ];

  const nativeBaseline = results[6].p50_ms;
  printComparisonTable(
    "SortEngine vs Native Array.sort — Performance Comparison (100k items)",
    results.slice(0, 6).map(
      (r): TableRow => ({
        label: r.scenario,
        engineMs: r.p50_ms,
        nativeMs: nativeBaseline,
        speedup: speedupStr(nativeBaseline, r.p50_ms),
      }),
    ),
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
    console.log("\n✅  All SortEngine scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failed.join(" | ")}`);
    process.exitCode = 1;
  }
}

main().catch(console.error);
