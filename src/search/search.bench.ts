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
 *   F  — Non-indexed linear vs native multi-field (sanity / parity check)
 *
 * Why n-gram indexing wins:
 *   - Multi-field: index intersects posting lists per field, skipping non-matching items
 *     entirely; native must check every item × every field.
 *   - Long queries: more trigrams → tighter intersection → fewer candidates to verify.
 *   - Previous-result narrowing: searches a small subset instead of the full dataset.
 *
 * Metrics    : min_ms · p50_ms (median) · max_ms  across 5 measurement runs
 * Warm-up    : 3 un-timed runs per scenario to saturate V8 JIT before measuring
 * Thresholds : p50 <= 200 ms · memory <= 30 MB
 *
 * Run with:  npx tsx src/search/search.bench.ts
 * For GC isolation between scenarios (more accurate memory):
 *   node --expose-gc -e "require('tsx').register()" src/search/search.bench.ts
 */

import { TextSearchEngine } from "./text-search";

/* -- Dataset type --------------------------------------------------------------- */
interface Item {
  id: number;
  name: string;
  email: string;
  city: string;
  tag: string;
}

/* -- Constants ------------------------------------------------------------------ */
const N = 100_000;
const WARMUP_RUNS = 3;
const MEASURE_RUNS = 5;

const THRESHOLDS = {
  time_ms: 200,
  memory_mb: 30,
} as const;

/* -- Name pools for realistic substring queries --------------------------------- */
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

/* -- Dataset generator --------------------------------------------------------- */
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

/* -- Result types --------------------------------------------------------------- */
interface ScenarioResult {
  scenario: string;
  query: string;
  result_count: number;
  min_ms: number;
  p50_ms: number;
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

/* -- Measurement helpers -------------------------------------------------------- */
function heapMB(): number {
  return process.memoryUsage().heapUsed / 1_048_576;
}

function run<T>(
  scenario: string,
  query: string,
  fn: () => T[],
): ScenarioResult {
  const round = (v: number) => Math.round(v * 10) / 10;

  // Warm-up: let V8 JIT compile hot paths before measuring
  for (let w = 0; w < WARMUP_RUNS; w++) fn();
  globalThis.gc?.();

  // Isolated memory measurement (single run after warm-up)
  const memBefore = heapMB();
  const memResult = fn();
  const memAfter = heapMB();
  const memory_mb = Math.round(Math.max(0, memAfter - memBefore) * 100) / 100;
  const result_count = memResult.length;
  globalThis.gc?.();

  // Timing: collect wall-clock samples across MEASURE_RUNS
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
    query,
    result_count,
    min_ms,
    p50_ms,
    max_ms,
    memory_mb,
    status: failed.length === 0 ? "PASS" : "FAIL",
    failed_metrics: failed,
  };
}

/* -- Native multi-field search helpers ----------------------------------------- */

/**
 * Case-insensitive native single-field substring filter.
 * Mirrors what TextSearchEngine does for a single field with an index.
 */
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

/**
 * Case-insensitive native all-fields substring filter (checks every string field).
 * Mirrors what TextSearchEngine does for all-fields search with an index.
 */
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

/* -- Main ----------------------------------------------------------------------- */
async function main(): Promise<void> {
  console.log(`\n=== TextSearchEngine Benchmark  n=${N.toLocaleString()} ===`);
  console.log(
    `Thresholds: time <= ${THRESHOLDS.time_ms} ms | memory <= ${THRESHOLDS.memory_mb} MB\n`,
  );

  const dataset = generateDataset();

  /*
   * Engines created once — index-build cost is intentionally excluded from
   * search-scenario measurements so we benchmark only the search() call itself.
   */
  const indexedEngine = new TextSearchEngine<Item>({
    data: dataset,
    fields: ["name", "email", "city", "tag"],
  });

  const noIndexEngine = new TextSearchEngine<Item>({ data: dataset });

  const filterByPrevEngine = new TextSearchEngine<Item>({
    data: dataset,
    fields: ["name", "email", "city", "tag"],
    filterByPreviousResult: true,
  });

  const results: ScenarioResult[] = [
    // ── Group A: Single-field "john" (4-char, ~10 000 hits) ───────────────────────

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

    // ── Group B: Multi-field "john" (4-char, ~10 000 hits) ───────────────────────

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

    // ── Group C: Multi-field "jo" (2-char — fewer trigrams, larger posting lists) ─

    run("C1. TextSearchEngine - indexed all-fields (query: 'jo')", "jo", () =>
      indexedEngine.search("jo"),
    ),
    run(
      "C2. Native Array.filter - all-fields (every field.toLowerCase includes 'jo')",
      "jo",
      () => nativeAllFields(dataset, "jo"),
    ),

    // ── Group D: Multi-field "san antonio" (11-char — highly selective) ───────────

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

    // ── Group E: filterByPreviousResult narrowing vs native two-step ─────────────
    // Both sides start from the full 100k dataset and perform a two-step search:
    // first compute the "jo" result, then narrow it to "john".
    // This mirrors realistic incremental search (user types "jo" then "john").

    run(
      "E1. TextSearchEngine - filterByPreviousResult two-step search ('jo' → 'john')",
      "john",
      () => {
        filterByPrevEngine.resetSearchState();
        filterByPrevEngine.search("jo"); // primes previousResult (~indexed all-fields)
        return filterByPrevEngine.search("john"); // narrows subset linearly
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

    // ── Group F: Non-indexed linear vs native (parity / sanity check) ─────────────
    // TextSearchEngine linear fallback should match native performance.

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
  ];

  /* -- Speedup summary ---------------------------------------------------------- */
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
        "Two-step search 'jo'→'john' (engine: indexed+linear; native: filter+filter)",
      engine_p50_ms: p50("E1"),
      native_p50_ms: p50("E2"),
      speedup: speedup(p50("E2"), p50("E1")),
    },
    {
      group: "F",
      description: "Non-indexed linear fallback vs native multi-field (parity)",
      engine_p50_ms: p50("F1"),
      native_p50_ms: p50("F2"),
      speedup: speedup(p50("F2"), p50("F1")),
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

  console.log(
    "\n── Speedup summary (TextSearchEngine vs Native) ──────────────",
  );
  for (const g of comparison_summary) {
    const arrow = g.speedup.includes("faster") ? "✅" : "⚠️ ";
    console.log(
      `  ${arrow} Group ${g.group}: engine ${g.engine_p50_ms} ms  native ${g.native_p50_ms} ms  → ${g.speedup}`,
    );
    console.log(`     ${g.description}`);
  }

  if (report.overall_status === "PASS") {
    console.log("\n✅  All scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failedScenarios.join(" | ")}`);
  }
}

main().catch(console.error);
