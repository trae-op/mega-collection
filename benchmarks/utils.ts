import os from "os";
import { execSync } from "child_process";

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
export const MEASURE_RUNS = 5;

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

export function printBenchHeader(runCmd: string): void {
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
