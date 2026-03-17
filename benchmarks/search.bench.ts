/**
 * TextSearchEngine Performance Benchmark — 100 000-element dataset
 *
 * Compares TextSearchEngine (n-gram index) against native Array.filter
 * across matched scenario pairs, so the real advantage is measurable.
 *
 * Comparison groups (each engine scenario paired with a native equivalent):
 *   A  — Single-field search "john"         (4-char,  ~10 000 hits)
 *   B  — Multi-field search "john"          (4-char,  ~10 000 hits)
 *   C  — Multi-field search "jo"            (2-char,  ~20 000 hits, fewer trigrams)
 *   D  — Multi-field search "san antonio"   (11-char,  ~10 000 hits, highly selective)
 *   E  — filterByPreviousResult narrowing vs native re-filter ("jo" → "john")
 *   E3/E4 — pre-warmed step-2 only (planner vs linear subset re-filter)
 *   F  — Non-indexed linear vs native multi-field (sanity / parity check)
 *
 * Why n-gram indexing wins:
 *   - Multi-field: index intersects posting lists per field, skipping non-matching items
 *     entirely; native must check every item × every field.
 *   - Long queries: more trigrams → tighter intersection → fewer candidates to verify.
 *   - Previous-result narrowing: searches a small subset instead of the full dataset.
 *
 * Metrics    : min_ms · p50_ms · p95_ms · p99_ms · max_ms across 15 measurement runs
 * Warm-up    : 3 un-timed runs per scenario to saturate V8 JIT before measuring
 * Thresholds : p50 <= 200 ms · memory <= 30 MB
 *
 * Run with:  npx tsx src/search/search.bench.ts
 * For GC isolation between scenarios (more accurate memory):
 *   node --expose-gc -e "require('tsx').register()" src/search/search.bench.ts
 */

/// <reference types="node" />

import { TextSearchEngine } from "../src/search/text-search";
import { CLR, MEASURE_RUNS, N, printBenchHeader, WARMUP_RUNS } from "./utils";

const SEARCH_WARMUP_RUNS = WARMUP_RUNS;
const SEARCH_MEASURE_RUNS = 15;

interface Item {
  id: number;
  name: string;
  email: string;
  city: string;
  tag: string;
}

const THRESHOLDS = {
  time_ms: 200,
  memory_mb: 30,
} as const;

const E_STEP2_MIN_SPEEDUP = 1.2;

const FIRST_NAMES = [
  "john",
  "jane",
  "michael",
  "sarah",
  "david",
  "emily",
  "robert",
  "jessica",
  "william",
  "ashley",
];
const CITIES = [
  "new york",
  "los angeles",
  "chicago",
  "houston",
  "phoenix",
  "philadelphia",
  "san antonio",
  "san diego",
  "dallas",
  "san jose",
];

interface ScenarioResult {
  scenario: string;
  query: string;
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

interface ComparisonGroup {
  group: string;
  description: string;
  engine_p50_ms: number;
  native_p50_ms: number;
  speedup: string;
}

interface BenchReport {
  dataset_size: number;
  warmup_runs: number;
  measure_runs: number;
  results: ScenarioResult[];
  comparison_summary: ComparisonGroup[];
  failed_scenarios: string[];
  overall_status: "PASS" | "FAIL";
}

interface TableRow {
  label: string;
  engineMs: number;
  nativeMs: number;
  speedup: string;
}

interface LatencyTableRow {
  scenario: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
}

function generateDataset(): Item[] {
  const data: Item[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const city = CITIES[i % CITIES.length];
    data[i] = {
      id: i,
      name: `${firstName}-${i}`,
      email: `${firstName}${i}@example.com`,
      city,
      tag: i % 2 === 0 ? "even" : "odd",
    };
  }
  return data;
}

function heapMB(): number {
  return process.memoryUsage().heapUsed / 1_048_576;
}

function percentile(sortedValues: number[], value: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const rank = Math.ceil((value / 100) * sortedValues.length) - 1;
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank));
  return sortedValues[index];
}

function run<T>(
  scenario: string,
  query: string,
  fn: () => T[],
): ScenarioResult {
  const round = (v: number) => Math.round(v * 10) / 10;

  for (let w = 0; w < SEARCH_WARMUP_RUNS; w++) fn();
  globalThis.gc?.();

  const memBefore = heapMB();
  const memResult = fn();
  const memAfter = heapMB();
  const memory_mb = Math.round(Math.max(0, memAfter - memBefore) * 100) / 100;
  const result_count = memResult.length;
  globalThis.gc?.();

  const times: number[] = [];
  for (let r = 0; r < SEARCH_MEASURE_RUNS; r++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  const min_ms = round(times[0]);
  const p50_ms = round(percentile(times, 50));
  const p95_ms = round(percentile(times, 95));
  const p99_ms = round(percentile(times, 99));
  const max_ms = round(times[SEARCH_MEASURE_RUNS - 1]);

  const failed: string[] = [];
  if (p50_ms > THRESHOLDS.time_ms) failed.push("p50_ms");
  if (memory_mb > THRESHOLDS.memory_mb) failed.push("memory_mb");

  return {
    scenario,
    query,
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

function runPrewarmed<T>(
  scenario: string,
  query: string,
  prepare: () => void,
  fn: () => T[],
): ScenarioResult {
  const round = (v: number) => Math.round(v * 10) / 10;

  for (let warmupIndex = 0; warmupIndex < SEARCH_WARMUP_RUNS; warmupIndex++) {
    prepare();
    fn();
  }
  globalThis.gc?.();

  prepare();
  const memBefore = heapMB();
  const memResult = fn();
  const memAfter = heapMB();
  const memory_mb = Math.round(Math.max(0, memAfter - memBefore) * 100) / 100;
  const result_count = memResult.length;
  globalThis.gc?.();

  const times: number[] = [];
  for (let runIndex = 0; runIndex < SEARCH_MEASURE_RUNS; runIndex++) {
    prepare();
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  const min_ms = round(times[0]);
  const p50_ms = round(percentile(times, 50));
  const p95_ms = round(percentile(times, 95));
  const p99_ms = round(percentile(times, 99));
  const max_ms = round(times[SEARCH_MEASURE_RUNS - 1]);

  const failed: string[] = [];
  if (p50_ms > THRESHOLDS.time_ms) failed.push("p50_ms");
  if (memory_mb > THRESHOLDS.memory_mb) failed.push("memory_mb");

  return {
    scenario,
    query,
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

function nativeSingleField(
  data: Item[],
  field: keyof Item & string,
  query: string,
): Item[] {
  const lq = query.toLowerCase();
  return data.filter((item) => {
    const v = item[field];
    return typeof v === "string" && v.toLowerCase().includes(lq);
  });
}

function nativeAllFields(data: Item[], query: string): Item[] {
  const lq = query.toLowerCase();
  return data.filter(
    (item) =>
      item.name.toLowerCase().includes(lq) ||
      item.email.toLowerCase().includes(lq) ||
      item.city.toLowerCase().includes(lq) ||
      item.tag.toLowerCase().includes(lq),
  );
}

function printComparisonTable(title: string, rows: TableRow[]): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const trunc = (s: string, n: number) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  const colLabel = Math.max(44, ...rows.map((r) => r.label.length + 2));
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

function printLatencyTable(title: string, rows: LatencyTableRow[]): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const trunc = (s: string, n: number) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  const colScenario = Math.max(
    44,
    ...rows.map((row) => row.scenario.length + 2),
  );
  const colValue = 10;
  const total = colScenario + colValue * 4 + 4;
  const bar = "═".repeat(total);
  const sep = "─".repeat(total);
  const h = (s: string) => `${CLR.bold}${CLR.cyan}${s}${CLR.reset}`;

  console.log(`\n${h(bar)}`);
  console.log(h(`  ${title}`));
  console.log(h(bar));
  console.log(
    `${CLR.bold}  ${pad("Scenario", colScenario)}${pad("p50", colValue)}${pad("p95", colValue)}${pad("p99", colValue)}Max${CLR.reset}`,
  );
  console.log(sep);

  for (const row of rows) {
    console.log(
      `  ${pad(trunc(row.scenario, colScenario), colScenario)}` +
        `${pad(row.p50_ms + " ms", colValue)}` +
        `${pad(row.p95_ms + " ms", colValue)}` +
        `${pad(row.p99_ms + " ms", colValue)}` +
        `${row.max_ms} ms`,
    );
  }

  console.log(h(bar));
}

function speedupRatio(nativeMs: number, engineMs: number): number {
  if (engineMs === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return nativeMs / engineMs;
}

async function main(): Promise<void> {
  printBenchHeader("search-bench", {
    warmupRuns: SEARCH_WARMUP_RUNS,
    measureRuns: SEARCH_MEASURE_RUNS,
    metricsLabel:
      "p50 / p95 / p99 latency across all iterations (lower is better)",
  });
  const dataset = generateDataset();

  const indexedEngine = new TextSearchEngine<Item>({
    data: dataset,
    fields: ["name", "email", "city", "tag"],
  });

  const noIndexEngine = new TextSearchEngine<Item>({
    data: dataset,
    silent: true,
  });

  const filterByPrevEngine = new TextSearchEngine<Item>({
    data: dataset,
    fields: ["name", "email", "city", "tag"],
    filterByPreviousResult: true,
  });

  let previousSubset: Item[] = [];

  const results: ScenarioResult[] = [
    run(
      "A1. TextSearchEngine - indexed single-field (name, query: 'john')",
      "john",
      () => indexedEngine.search("name", "john"),
    ),
    run(
      "A2. Native Array.filter - single-field (name.toLowerCase includes 'john')",
      "john",
      () => nativeSingleField(dataset, "name", "john"),
    ),

    run(
      "B1. TextSearchEngine - indexed all-fields (query: 'john')",
      "john",
      () => indexedEngine.search("john"),
    ),
    run(
      "B2. Native Array.filter - all-fields (every field.toLowerCase includes 'john')",
      "john",
      () => nativeAllFields(dataset, "john"),
    ),

    run("C1. TextSearchEngine - indexed all-fields (query: 'jo')", "jo", () =>
      indexedEngine.search("jo"),
    ),
    run(
      "C2. Native Array.filter - all-fields (every field.toLowerCase includes 'jo')",
      "jo",
      () => nativeAllFields(dataset, "jo"),
    ),

    run(
      "D1. TextSearchEngine - indexed all-fields (query: 'san antonio')",
      "san antonio",
      () => indexedEngine.search("san antonio"),
    ),
    run(
      "D2. Native Array.filter - all-fields (every field.toLowerCase includes 'san antonio')",
      "san antonio",
      () => nativeAllFields(dataset, "san antonio"),
    ),

    run(
      "E1. TextSearchEngine - filterByPreviousResult two-step search ('jo' → 'john')",
      "john",
      () => {
        filterByPrevEngine.resetSearchState();
        filterByPrevEngine.search("jo");
        return filterByPrevEngine.search("john");
      },
    ),
    run(
      "E2. Native two-step: nativeAllFields('jo') then re-filter result for 'john'",
      "john",
      () => {
        const prev = nativeAllFields(dataset, "jo");
        return nativeAllFields(prev, "john");
      },
    ),
    runPrewarmed(
      "E3. TextSearchEngine - step 2 only (pre-warmed 'jo' intermediate)",
      "john",
      () => {
        filterByPrevEngine.resetSearchState();
        filterByPrevEngine.search("jo");
      },
      () => filterByPrevEngine.search("john"),
    ),
    runPrewarmed(
      "E4. Baseline step 2 only - linear re-filter over pre-warmed 'jo' subset",
      "john",
      () => {
        previousSubset = nativeAllFields(dataset, "jo");
      },
      () => nativeAllFields(previousSubset, "john"),
    ),

    run(
      "F1. TextSearchEngine - non-indexed linear fallback (query: 'john')",
      "john",
      () => noIndexEngine.search("john"),
    ),
    run(
      "F2. Native Array.filter - all-fields (every field.toLowerCase includes 'john')",
      "john",
      () => nativeAllFields(dataset, "john"),
    ),

    run(
      "G1. TextSearchEngine - indexed all-fields worst-case absent long query",
      "supercalifragilisticexpialidocious-absent",
      () => indexedEngine.search("supercalifragilisticexpialidocious-absent"),
    ),
    run(
      "G2. Native Array.filter - all-fields worst-case absent long query",
      "supercalifragilisticexpialidocious-absent",
      () =>
        nativeAllFields(dataset, "supercalifragilisticexpialidocious-absent"),
    ),
  ];

  function p50(label: string): number {
    return results.find((r) => r.scenario.startsWith(label))?.p50_ms ?? 0;
  }

  function speedup(nativeMs: number, engineMs: number): string {
    if (engineMs === 0) return "N/A";
    const ratio = nativeMs / engineMs;
    return `${ratio.toFixed(2)}x ${ratio >= 1 ? "faster" : "slower"}`;
  }

  const comparison_summary: ComparisonGroup[] = [
    {
      group: "A",
      description: "Single-field search 'john' (4-char, ~10k hits)",
      engine_p50_ms: p50("A1"),
      native_p50_ms: p50("A2"),
      speedup: speedup(p50("A2"), p50("A1")),
    },
    {
      group: "B",
      description: "Multi-field search 'john' (4-char, ~10k hits)",
      engine_p50_ms: p50("B1"),
      native_p50_ms: p50("B2"),
      speedup: speedup(p50("B2"), p50("B1")),
    },
    {
      group: "C",
      description: "Multi-field search 'jo' (2-char, ~20k hits)",
      engine_p50_ms: p50("C1"),
      native_p50_ms: p50("C2"),
      speedup: speedup(p50("C2"), p50("C1")),
    },
    {
      group: "D",
      description: "Multi-field search 'san antonio' (11-char, ~10k hits)",
      engine_p50_ms: p50("D1"),
      native_p50_ms: p50("D2"),
      speedup: speedup(p50("D2"), p50("D1")),
    },
    {
      group: "E",
      description:
        "Two-step search 'jo'→'john' (engine: candidate-aware narrow; native: filter+filter)",
      engine_p50_ms: p50("E1"),
      native_p50_ms: p50("E2"),
      speedup: speedup(p50("E2"), p50("E1")),
    },
    {
      group: "E-step2",
      description:
        "Pre-warmed step 2 only (candidate-aware narrow vs linear subset re-filter)",
      engine_p50_ms: p50("E3"),
      native_p50_ms: p50("E4"),
      speedup: speedup(p50("E4"), p50("E3")),
    },
    {
      group: "F",
      description: "Non-indexed linear fallback vs native multi-field (parity)",
      engine_p50_ms: p50("F1"),
      native_p50_ms: p50("F2"),
      speedup: speedup(p50("F2"), p50("F1")),
    },
    {
      group: "G",
      description: "Worst-case absent long query across all fields",
      engine_p50_ms: p50("G1"),
      native_p50_ms: p50("G2"),
      speedup: speedup(p50("G2"), p50("G1")),
    },
  ];

  const failedScenarios = results
    .filter((r) => r.status === "FAIL")
    .map((r) => r.scenario);

  const eStep2Ratio = speedupRatio(p50("E4"), p50("E3"));
  if (eStep2Ratio < E_STEP2_MIN_SPEEDUP) {
    failedScenarios.push(
      `E-step2 regression gate: expected >= ${E_STEP2_MIN_SPEEDUP.toFixed(2)}x, got ${eStep2Ratio.toFixed(2)}x`,
    );
  }

  const report: BenchReport = {
    dataset_size: N,
    warmup_runs: SEARCH_WARMUP_RUNS,
    measure_runs: SEARCH_MEASURE_RUNS,
    results,
    comparison_summary,
    failed_scenarios: failedScenarios,
    overall_status: failedScenarios.length === 0 ? "PASS" : "FAIL",
  };

  printComparisonTable(
    "TextSearchEngine vs Native — Performance Comparison (100k items)",
    comparison_summary.map((g) => ({
      label: `Group ${g.group}: ${g.description}`,
      engineMs: g.engine_p50_ms,
      nativeMs: g.native_p50_ms,
      speedup: g.speedup,
    })),
  );

  printLatencyTable(
    "Per-scenario tail latency",
    results.map((result) => ({
      scenario: result.scenario,
      p50_ms: result.p50_ms,
      p95_ms: result.p95_ms,
      p99_ms: result.p99_ms,
      max_ms: result.max_ms,
    })),
  );

  if (report.overall_status === "PASS") {
    console.log("\n✅  All scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failedScenarios.join(" | ")}`);
    process.exitCode = 1;
  }
}

main().catch(console.error);
