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

/// <reference types="node" />
import os from "os";
import { execSync } from "child_process";
import { TextSearchEngine } from "../src/search/text-search";

interface Item {
  id: number;
  name: string;
  email: string;
  city: string;
  tag: string;
}

const N = 100_000;
const WARMUP_RUNS = 3;
const MEASURE_RUNS = 5;

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

const CLR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

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

interface TableRow {
  label: string;
  engineMs: number;
  nativeMs: number;
  speedup: string;
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

function getOsLabel(): string {
  const platform = os.platform();

  if (platform === "win32") {
    try {
      const raw = execSync("ver", { encoding: "utf8" }).trim();
      return raw.replace(/[\r\n]+/g, " ");
    } catch {
      return `Windows ${os.release()}`;
    }
  }

  if (platform === "darwin") {
    const DARWIN_TO_MACOS: Record<number, string> = {
      20: "macOS 11 Big Sur",
      21: "macOS 12 Monterey",
      22: "macOS 13 Ventura",
      23: "macOS 14 Sonoma",
      24: "macOS 15 Sequoia",
    };
    const major = parseInt(os.release().split(".")[0], 10);
    const name = DARWIN_TO_MACOS[major] ?? `macOS (Darwin ${os.release()})`;

    try {
      const version = execSync("sw_vers -productVersion", {
        encoding: "utf8",
      }).trim();
      return `${name} ${version}`;
    } catch {
      return name;
    }
  }

  if (platform === "linux") {
    try {
      const raw = execSync(
        "cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'",
        { encoding: "utf8" },
      ).trim();
      return raw || `Linux ${os.release()}`;
    } catch {
      return `Linux ${os.release()}`;
    }
  }

  return `${platform} ${os.release()}`;
}

function getCpuModel(): string {
  const model = os.cpus()[0]?.model ?? "unknown CPU";
  return model.trim().replace(/\s+/g, " ");
}

function heapMB(): number {
  return process.memoryUsage().heapUsed / 1_048_576;
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

function printBenchHeader(runCmd: string): void {
  const osLabel = getOsLabel();
  const cpuModel = getCpuModel();
  const ramGB = Math.round(os.totalmem() / 1_073_741_824);

  console.log();
  console.log(
    `${CLR.bold}${CLR.cyan}  Measured on${CLR.reset}  @devisfuture/mega-collection v2.3.5`,
  );
  console.log(
    `${CLR.bold}${CLR.cyan}  Environment${CLR.reset}  Node.js ${process.version} · ${osLabel} · ${cpuModel} · ${ramGB} GB RAM`,
  );
  console.log(
    `${CLR.bold}${CLR.cyan}  Benchmark  ${CLR.reset}  Warmup: ${WARMUP_RUNS} un-timed runs · Measured: ${MEASURE_RUNS} timed runs per scenario`,
  );
  console.log(
    `${CLR.bold}${CLR.cyan}  Metrics    ${CLR.reset}  p50 = median latency across all iterations ${CLR.dim}(lower is better)${CLR.reset}`,
  );
  console.log(
    `${CLR.bold}${CLR.cyan}  Reproduce  ${CLR.reset}  ${CLR.dim}npm run ${runCmd}${CLR.reset}`,
  );
  console.log();
}

async function main(): Promise<void> {
  printBenchHeader("search-bench");
  const dataset = generateDataset();

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

  printComparisonTable(
    "TextSearchEngine vs Native — Performance Comparison (100k items)",
    comparison_summary.map((g) => ({
      label: `Group ${g.group}: ${g.description}`,
      engineMs: g.engine_p50_ms,
      nativeMs: g.native_p50_ms,
      speedup: g.speedup,
    })),
  );

  if (report.overall_status === "PASS") {
    console.log("\n✅  All scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failedScenarios.join(" | ")}`);
  }
}

main().catch(console.error);
