/// <reference types="node" />

import { FilterEngine } from "../src/filter/filter";
import {
  heapMB,
  type LatencyTableRow,
  MEASURE_RUNS,
  N,
  percentile,
  printBenchHeader,
  printComparisonTable,
  printLatencyTable,
  speedupStr,
  type TableRow,
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

interface ScenarioResult {
  scenario: string;
  result_count: number;
  min_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  memory_mb: number;
}

const STATUSES = ["pending", "active", "closed", "archived", "review"];
const CATEGORIES = ["A", "B", "C", "D"];
const REGIONS = ["north", "south", "east"];
const REMOVE_STEPS = 30;
const IDS_PER_STEP = 5;

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

function createRemoveBatches(): number[][] {
  const batches: number[][] = [];
  const seenIds = new Set<number>();
  let cursor = 17;

  for (let stepIndex = 0; stepIndex < REMOVE_STEPS; stepIndex++) {
    const batch: number[] = [];

    while (batch.length < IDS_PER_STEP) {
      cursor = (cursor + 7_919) % N;

      if (seenIds.has(cursor)) {
        continue;
      }

      seenIds.add(cursor);
      batch.push(cursor);
    }

    batches.push(batch);
  }

  return batches;
}

function runSession(
  scenario: string,
  setup: () => void,
  fn: () => Item[],
): ScenarioResult {
  const round = (value: number) => Math.round(value * 10) / 10;

  for (let warmupIndex = 0; warmupIndex < WARMUP_RUNS; warmupIndex++) {
    setup();
    fn();
  }

  globalThis.gc?.();

  setup();
  const memBefore = heapMB();
  const memResult = fn();
  const memAfter = heapMB();
  globalThis.gc?.();

  const times: number[] = [];

  for (let measureIndex = 0; measureIndex < MEASURE_RUNS; measureIndex++) {
    setup();
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }

  times.sort((left, right) => left - right);

  return {
    scenario,
    result_count: memResult.length,
    min_ms: round(times[0]),
    p50_ms: round(percentile(times, 50)),
    p95_ms: round(percentile(times, 95)),
    p99_ms: round(percentile(times, 99)),
    max_ms: round(times[MEASURE_RUNS - 1]),
    memory_mb: Math.round(Math.max(0, memAfter - memBefore) * 100) / 100,
  };
}

async function main(): Promise<void> {
  printBenchHeader("filter-remove-bench", {
    metricsLabel:
      "p50 / p95 / p99 latency across full cumulative-exclude sessions (lower is better)",
  });

  const dataset = generateDataset();
  const removeBatches = createRemoveBatches();
  const engine = new FilterEngine<Item>({
    data: dataset,
    fields: ["id"],
    filterByPreviousResult: true,
  });

  const nativeSession = runSession(
    "[F1] Native cumulative exclude session — rebuild visible list on every delete",
    () => {},
    () => {
      const excludedIds = new Set<number>();
      let result = dataset;

      for (let stepIndex = 0; stepIndex < removeBatches.length; stepIndex++) {
        const batch = removeBatches[stepIndex];

        for (let idIndex = 0; idIndex < batch.length; idIndex++) {
          excludedIds.add(batch[idIndex]);
        }

        result = dataset.filter((item) => !excludedIds.has(item.id));
      }

      return result;
    },
  );

  const engineSession = runSession(
    "[F2] FilterEngine cumulative exclude session — grow id exclude set incrementally",
    () => engine.resetFilterState(),
    () => {
      const excludedIds: number[] = [];
      let result = dataset;

      for (let stepIndex = 0; stepIndex < removeBatches.length; stepIndex++) {
        const batch = removeBatches[stepIndex];

        for (let idIndex = 0; idIndex < batch.length; idIndex++) {
          excludedIds.push(batch[idIndex]);
        }

        result = engine.filter([{ field: "id", exclude: excludedIds }]);
      }

      return result;
    },
  );

  const comparisonRows: TableRow[] = [
    {
      label: "F — component-like cumulative exclude session (30 steps × 5 ids)",
      engineMs: engineSession.p50_ms,
      nativeMs: nativeSession.p50_ms,
      speedup: speedupStr(nativeSession.p50_ms, engineSession.p50_ms),
    },
  ];

  printComparisonTable(
    "FilterEngine vs Native — Cumulative Exclude Session",
    comparisonRows,
  );

  printLatencyTable(
    "Per-scenario tail latency",
    [nativeSession, engineSession].map(
      (result): LatencyTableRow => ({
        scenario: result.scenario,
        p50_ms: result.p50_ms,
        p95_ms: result.p95_ms,
        p99_ms: result.p99_ms,
        max_ms: result.max_ms,
      }),
    ),
  );
}

main().catch(console.error);
