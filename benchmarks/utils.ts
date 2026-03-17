import os from "os";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const _dir = dirname(fileURLToPath(import.meta.url));
const _pkg = JSON.parse(
  readFileSync(join(_dir, "../package.json"), "utf8"),
) as { name: string; version: string };

export const CLR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

export const N = 100_000;
export const WARMUP_RUNS = 3;
export const MEASURE_RUNS = 15;

export interface TableRow {
  label: string;
  engineMs: number;
  nativeMs: number;
  speedup: string;
}

export interface LatencyTableRow {
  scenario: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
}

export function heapMB(): number {
  return process.memoryUsage().heapUsed / 1_048_576;
}

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
  );
  return sortedValues[idx];
}

export function speedupStr(nativeMs: number, engineMs: number): string {
  if (engineMs <= 0) return "∞x (cache hit)";
  const ratio = nativeMs / engineMs;
  return ratio >= 1
    ? `${ratio.toFixed(1)}x faster`
    : `${(1 / ratio).toFixed(1)}x slower`;
}

export function printComparisonTable(title: string, rows: TableRow[]): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const trunc = (s: string, n: number) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  // Allow longer scenario descriptions to be rendered in full on wider terminals.
  // The cap prevents runaway table width in narrow terminals.
  const colLabel = Math.min(
    160,
    Math.max(60, ...rows.map((r) => r.label.length + 2)),
  );
  const colMs = 12;
  const colSpeedup = 18;
  const total = colLabel + colMs * 2 + colSpeedup + 4;
  const bar = "═".repeat(total);
  const sep = "─".repeat(total);
  const h = (s: string) => `${CLR.bold}${CLR.cyan}${s}${CLR.reset}`;

  console.log(h(bar));
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
    console.log(
      `  ${pad(trunc(row.label, colLabel), colLabel)}` +
        `${eColor}${pad(row.engineMs + " ms", colMs)}${CLR.reset}` +
        `${nColor}${pad(row.nativeMs + " ms", colMs)}${CLR.reset}` +
        `${sColor}${row.speedup}${CLR.reset}`,
    );
  }

  console.log(h(bar));
}

export function printLatencyTable(
  title: string,
  rows: LatencyTableRow[],
): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const trunc = (s: string, n: number) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  // Allow longer scenario descriptions to be rendered in full on wider terminals.
  // The cap prevents runaway table width in narrow terminals.
  const colScenario = Math.min(
    160,
    Math.max(60, ...rows.map((r) => r.scenario.length + 2)),
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

type BenchHeaderOptions = {
  warmupRuns?: number;
  measureRuns?: number;
  metricsLabel?: string;
};

function getOsLabel(): string {
  const platform = os.platform();

  if (platform === "win32") {
    try {
      return execSync("ver", { encoding: "utf8" })
        .trim()
        .replace(/[\r\n]+/g, " ");
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
      return `${name} ${execSync("sw_vers -productVersion", { encoding: "utf8" }).trim()}`;
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
  return (os.cpus()[0]?.model ?? "unknown CPU").trim().replace(/\s+/g, " ");
}

export function printBenchHeader(
  runCmd: string,
  options: BenchHeaderOptions = {},
): void {
  const warmupRuns = options.warmupRuns ?? WARMUP_RUNS;
  const measureRuns = options.measureRuns ?? MEASURE_RUNS;
  const metricsLabel =
    options.metricsLabel ??
    "p50 = median latency across all iterations (lower is better)";
  const osLabel = getOsLabel();
  const cpuModel = getCpuModel();
  const ramGB = Math.round(os.totalmem() / 1_073_741_824);

  console.log();
  console.log(
    `${CLR.bold}${CLR.cyan}  Measured on${CLR.reset}  ${_pkg.name} v${_pkg.version}`,
  );
  console.log(
    `${CLR.bold}${CLR.cyan}  Environment${CLR.reset}  Node.js ${process.version} · ${osLabel} · ${cpuModel} · ${ramGB} GB RAM`,
  );
  console.log(
    `${CLR.bold}${CLR.cyan}  Benchmark  ${CLR.reset}  Warmup: ${warmupRuns} un-timed runs · Measured: ${measureRuns} timed runs per scenario`,
  );
  console.log(
    `${CLR.bold}${CLR.cyan}  Metrics    ${CLR.reset}  ${metricsLabel.replace("(lower is better)", `${CLR.dim}(lower is better)${CLR.reset}`)}`,
  );
  console.log(
    `${CLR.bold}${CLR.cyan}  Reproduce  ${CLR.reset}  ${CLR.dim}npm run ${runCmd}${CLR.reset}`,
  );
  console.log();
}
