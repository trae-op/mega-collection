/// <reference types="node" />

import { TextSearchEngine } from "../src/search/text-search";
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

const E_STEP2_MIN_SPEEDUP = 1.2;

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

function run<T>(
  scenario: string,
  query: string,
  fn: () => T[],
): ScenarioResult {
  const round = (v: number) => Math.round(v * 10) / 10;

  for (let w = 0; w < WARMUP_RUNS; w++) fn();
  globalThis.gc?.();

  const memBefore = heapMB();
  const memResult = fn();
  const memAfter = heapMB();
  const memory_mb = Math.round(Math.max(0, memAfter - memBefore) * 100) / 100;
  const result_count = memResult.length;
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

  for (let w = 0; w < WARMUP_RUNS; w++) {
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
  for (let r = 0; r < MEASURE_RUNS; r++) {
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
  const max_ms = round(times[MEASURE_RUNS - 1]);

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

async function main(): Promise<void> {
  printBenchHeader("search-bench", {
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

  const comparisonRows: TableRow[] = [
    {
      label: "A — single-field 'john' (~10k hits)",
      engineMs: p50("A1"),
      nativeMs: p50("A2"),
      speedup: speedupStr(p50("A2"), p50("A1")),
    },
    {
      label: "B — all-fields 'john' (~10k hits)",
      engineMs: p50("B1"),
      nativeMs: p50("B2"),
      speedup: speedupStr(p50("B2"), p50("B1")),
    },
    {
      label: "C — all-fields 'jo' (~20k hits, fewer trigrams)",
      engineMs: p50("C1"),
      nativeMs: p50("C2"),
      speedup: speedupStr(p50("C2"), p50("C1")),
    },
    {
      label: "D — all-fields 'san antonio' (~10k hits, highly selective)",
      engineMs: p50("D1"),
      nativeMs: p50("D2"),
      speedup: speedupStr(p50("D2"), p50("D1")),
    },
    {
      label: "E — two-step 'jo'→'john' (filterByPreviousResult)",
      engineMs: p50("E1"),
      nativeMs: p50("E2"),
      speedup: speedupStr(p50("E2"), p50("E1")),
    },
    {
      label: "E-step2 — pre-warmed step 2 only (narrow vs re-filter subset)",
      engineMs: p50("E3"),
      nativeMs: p50("E4"),
      speedup: speedupStr(p50("E4"), p50("E3")),
    },
    {
      label: "F — non-indexed linear fallback (parity check)",
      engineMs: p50("F1"),
      nativeMs: p50("F2"),
      speedup: speedupStr(p50("F2"), p50("F1")),
    },
    {
      label: "G — absent long query, worst-case scan",
      engineMs: p50("G1"),
      nativeMs: p50("G2"),
      speedup: speedupStr(p50("G2"), p50("G1")),
    },
  ];

  const failedScenarios = results
    .filter((r) => r.status === "FAIL")
    .map((r) => r.scenario);

  const eStep2Ratio = p50("E4") > 0 ? p50("E4") / p50("E3") : 0;
  if (eStep2Ratio < E_STEP2_MIN_SPEEDUP) {
    failedScenarios.push(
      `E-step2 regression gate: expected >= ${E_STEP2_MIN_SPEEDUP.toFixed(2)}x, got ${eStep2Ratio.toFixed(2)}x`,
    );
  }

  printComparisonTable(
    "TextSearchEngine vs Native — Performance Comparison (100k items)",
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

  if (failedScenarios.length === 0) {
    console.log("\n✅  All scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failedScenarios.join(" | ")}`);
    process.exitCode = 1;
  }
}

main().catch(console.error);
