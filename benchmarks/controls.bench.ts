/// <reference types="node" />

import { MergeEngines } from "../src";
import { FilterEngine } from "../src/filter";
import { TextSearchEngine } from "../src/search";
import { SortEngine } from "../src/sort";
import type { FilterCriterion, SortDescriptor } from "../src/types";
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
  name: string;
  city: string;
  status: string;
  age: number;
  score: number;
  active: boolean;
}

interface ScenarioResult {
  scenario: string;
  result_count: number;
  checksum: number;
  min_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  memory_mb: number;
  status: "PASS" | "FAIL";
  failed_metrics: string[];
}

interface OperationSummary {
  resultCount: number;
  checksum: number;
}

interface NativeRuntime {
  data: Item[];
  idToIndex: Map<number, number>;
}

const THRESHOLDS = {
  time_ms: 2_000,
  memory_mb: 45,
} as const;

const ADD_BATCH_SIZE = 2;
const REMOVE_BATCH_SIZE = 10;
const REMOVE_INTERVAL = 40;
const POST_MUTATION_READS = 1;

const FILTER_STATUSES = ["active", "pending"];
const CITIES = ["kyiv", "berlin", "miami", "tokyo", "oslo"] as const;
const STATUSES = ["pending", "active", "closed", "review"] as const;
const NAME_PREFIXES = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "gamma",
  "helix",
] as const;

const ADD_QUERY = "zenith";
const ADD_CITY = "delta-harbor";
const ADD_STATUS = "fresh";

const UPDATE_QUERY = "renewed";
const UPDATE_CITY = "renewed-city";
const UPDATE_STATUS = "priority";

const REMOVE_QUERY = "purge";

const FILTER_CRITERIA: FilterCriterion<Item>[] = [
  { field: "city", values: ["kyiv"] },
  { field: "status", values: FILTER_STATUSES as unknown as string[] },
];

const SORT_DESCRIPTORS: SortDescriptor<Item>[] = [
  { field: "score", direction: "asc" },
  { field: "age", direction: "desc" },
];

const BASE_DATASET = generateDataset();
const ADD_ITEMS = generateAddItems(BASE_DATASET.length, ADD_BATCH_SIZE);
const UPDATE_ITEM = generateUpdateItem(
  BASE_DATASET[Math.floor(BASE_DATASET.length / 2)],
);
const REMOVE_IDS = BASE_DATASET.filter((item) =>
  item.name.startsWith(`${REMOVE_QUERY}-`),
)
  .slice(0, REMOVE_BATCH_SIZE)
  .map((item) => item.id);

function generateDataset(): Item[] {
  const data: Item[] = new Array(N);

  for (let i = 0; i < N; i++) {
    const basePrefix = NAME_PREFIXES[i % NAME_PREFIXES.length];
    const namePrefix = i % REMOVE_INTERVAL === 0 ? REMOVE_QUERY : basePrefix;

    data[i] = {
      id: i,
      name: `${namePrefix}-${i}`,
      city: CITIES[i % CITIES.length],
      status: STATUSES[i % STATUSES.length],
      age: 18 + ((i * 7) % 43),
      score: (i * 48_271) % 1_000_003,
      active: i % 3 !== 0,
    };
  }

  return data;
}

function generateAddItems(startId: number, count: number): Item[] {
  const items: Item[] = new Array(count);

  for (let index = 0; index < count; index++) {
    const id = startId + index;
    items[index] = {
      id,
      name: `${ADD_QUERY}-${id}`,
      city: ADD_CITY,
      status: ADD_STATUS,
      age: 24 + (index % 19),
      score: 1_100_000 + index,
      active: true,
    };
  }

  return items;
}

function generateUpdateItem(source: Item): Item {
  return {
    ...source,
    name: `${UPDATE_QUERY}-${source.id}`,
    city: UPDATE_CITY,
    status: UPDATE_STATUS,
    age: 61,
    score: 2_000_000,
    active: true,
  };
}

function cloneItems(items: readonly Item[]): Item[] {
  return items.map((item) => ({ ...item }));
}

function createNativeRuntime(): NativeRuntime {
  const data = cloneItems(BASE_DATASET);
  return {
    data,
    idToIndex: buildIdToIndex(data),
  };
}

function buildIdToIndex(data: Item[]): Map<number, number> {
  const idToIndex = new Map<number, number>();

  for (let index = 0; index < data.length; index++) {
    idToIndex.set(data[index].id, index);
  }

  return idToIndex;
}

function createMergeRuntime(): MergeEngines<Item> {
  return new MergeEngines<Item>({
    imports: [TextSearchEngine, SortEngine, FilterEngine],
    data: cloneItems(BASE_DATASET),
    search: {
      fields: ["name", "city", "status"],
      minQueryLength: 1,
    },
    filter: {
      fields: ["id", "city", "status", "active"],
      mutableExcludeField: "id",
    },
    sort: {
      fields: ["score", "age", "name"],
    },
  });
}

function warmMergeRuntime(merge: MergeEngines<Item>): void {
  merge.search("name", "alpha");
  merge.filter([{ field: "status", values: ["active"] }]);
  merge.sort([{ field: "score", direction: "asc" }]);
}

function nativeSearchByName(data: Item[], query: string): Item[] {
  return data.filter((item) => item.name.includes(query));
}

function nativeFilterByCriteria(data: Item[]): Item[] {
  return data.filter(
    (item) =>
      item.city === "kyiv" &&
      (item.status === "active" || item.status === "pending"),
  );
}

function nativeSortByDescriptors(data: Item[]): Item[] {
  return data.slice().sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }

    return right.age - left.age;
  });
}

function nativeAdd(runtime: NativeRuntime, items: Item[]): void {
  for (let index = 0; index < items.length; index++) {
    const next = { ...items[index] };
    runtime.idToIndex.set(next.id, runtime.data.length);
    runtime.data.push(next);
  }
}

function nativeUpdate(runtime: NativeRuntime, items: Item[]): void {
  for (let index = 0; index < items.length; index++) {
    const next = items[index];
    const targetIndex = runtime.idToIndex.get(next.id);

    if (targetIndex === undefined) {
      continue;
    }

    runtime.data[targetIndex] = { ...next };
  }
}

function nativeMutableExclude(runtime: NativeRuntime, ids: number[]): void {
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    const removeIndex = runtime.idToIndex.get(id);

    if (removeIndex === undefined) {
      continue;
    }

    const lastIndex = runtime.data.length - 1;
    const lastItem = runtime.data[lastIndex];

    runtime.idToIndex.delete(id);

    if (removeIndex !== lastIndex) {
      runtime.data[removeIndex] = lastItem;
      runtime.idToIndex.set(lastItem.id, removeIndex);
    }

    runtime.data.pop();
  }
}

function summarizeOperations(
  searchResult: Item[],
  filterResult: Item[],
  sortResult: Item[],
): OperationSummary {
  const checksum =
    checksumIds(searchResult, 16) +
    checksumIds(filterResult, 16) * 3 +
    checksumIds(sortResult, 32) * 7 +
    sortResult.length;

  return {
    resultCount: searchResult.length + filterResult.length + sortResult.length,
    checksum,
  };
}

function checksumIds(items: Item[], sampleSize: number): number {
  const size = Math.min(sampleSize, items.length);
  let checksum = 0;

  for (let index = 0; index < size; index++) {
    checksum += items[index].id * (index + 1);
  }

  return checksum;
}

function runRepeatedReadWorkloadMerge(
  merge: MergeEngines<Item>,
  searchQuery: string,
  criteria: FilterCriterion<Item>[],
): OperationSummary {
  let aggregateResultCount = 0;
  let aggregateChecksum = 0;

  for (let index = 0; index < POST_MUTATION_READS; index++) {
    const summary = summarizeOperations(
      merge.search("name", searchQuery),
      merge.filter(criteria),
      merge.sort(SORT_DESCRIPTORS),
    );

    aggregateResultCount += summary.resultCount;
    aggregateChecksum += summary.checksum * (index + 1);
  }

  return {
    resultCount: aggregateResultCount,
    checksum: aggregateChecksum,
  };
}

function runRepeatedReadWorkloadNative(
  runtime: NativeRuntime,
  searchQuery: string,
  city: string,
  statuses: string[],
): OperationSummary {
  let aggregateResultCount = 0;
  let aggregateChecksum = 0;
  const allowedStatuses = new Set(statuses);

  for (let index = 0; index < POST_MUTATION_READS; index++) {
    const summary = summarizeOperations(
      nativeSearchByName(runtime.data, searchQuery),
      runtime.data.filter(
        (item) => item.city === city && allowedStatuses.has(item.status),
      ),
      nativeSortByDescriptors(runtime.data),
    );

    aggregateResultCount += summary.resultCount;
    aggregateChecksum += summary.checksum * (index + 1);
  }

  return {
    resultCount: aggregateResultCount,
    checksum: aggregateChecksum,
  };
}

function idsSorted(items: Item[]): number[] {
  return items.map((item) => item.id).sort((left, right) => left - right);
}

function assertSameIds(label: string, actual: Item[], expected: Item[]): void {
  const actualIds = idsSorted(actual);
  const expectedIds = idsSorted(expected);

  if (actualIds.length !== expectedIds.length) {
    throw new Error(
      `${label}: length mismatch (${actualIds.length} !== ${expectedIds.length})`,
    );
  }

  for (let index = 0; index < actualIds.length; index++) {
    if (actualIds[index] !== expectedIds[index]) {
      throw new Error(
        `${label}: mismatch at index ${index} (${actualIds[index]} !== ${expectedIds[index]})`,
      );
    }
  }
}

function assertSameSortedOrder(
  label: string,
  actual: Item[],
  expected: Item[],
): void {
  if (actual.length !== expected.length) {
    throw new Error(
      `${label}: length mismatch (${actual.length} !== ${expected.length})`,
    );
  }

  for (let index = 0; index < actual.length; index++) {
    if (actual[index].id !== expected[index].id) {
      throw new Error(
        `${label}: sort mismatch at index ${index} (${actual[index].id} !== ${expected[index].id})`,
      );
    }
  }
}

function verifyOperationParity(
  label: string,
  merge: MergeEngines<Item>,
  native: NativeRuntime,
  searchQuery: string,
  criteria: FilterCriterion<Item>[],
): void {
  assertSameIds(`${label} origin dataset`, merge.getOriginData(), native.data);

  const mergeSearch = merge.search("name", searchQuery);
  const nativeSearch = nativeSearchByName(native.data, searchQuery);
  assertSameIds(`${label} search`, mergeSearch, nativeSearch);

  const city = (criteria[0].values?.[0] as string) ?? "";
  const statuses = (criteria[1].values as string[] | undefined) ?? [];
  const allowedStatuses = new Set(statuses);

  const mergeFilter = merge.filter(criteria);
  const nativeFilter = native.data.filter(
    (item) => item.city === city && allowedStatuses.has(item.status),
  );
  assertSameIds(`${label} filter`, mergeFilter, nativeFilter);

  const mergeSort = merge.sort(SORT_DESCRIPTORS);
  const nativeSort = nativeSortByDescriptors(native.data);
  assertSameSortedOrder(`${label} sort`, mergeSort, nativeSort);
}

function runAddMerge(merge: MergeEngines<Item>): OperationSummary {
  merge.add(ADD_ITEMS);
  return runRepeatedReadWorkloadMerge(merge, ADD_QUERY, [
    { field: "city", values: [ADD_CITY] },
    { field: "status", values: [ADD_STATUS] },
  ]);
}

function runAddNative(runtime: NativeRuntime): OperationSummary {
  nativeAdd(runtime, ADD_ITEMS);
  return runRepeatedReadWorkloadNative(runtime, ADD_QUERY, ADD_CITY, [
    ADD_STATUS,
  ]);
}

function runUpdateMerge(merge: MergeEngines<Item>): OperationSummary {
  merge.update({
    field: "id",
    data: UPDATE_ITEM,
  });

  return runRepeatedReadWorkloadMerge(merge, UPDATE_QUERY, [
    { field: "city", values: [UPDATE_CITY] },
    { field: "status", values: [UPDATE_STATUS] },
  ]);
}

function runUpdateNative(runtime: NativeRuntime): OperationSummary {
  nativeUpdate(runtime, [UPDATE_ITEM]);
  return runRepeatedReadWorkloadNative(runtime, UPDATE_QUERY, UPDATE_CITY, [
    UPDATE_STATUS,
  ]);
}

function runDeleteMerge(merge: MergeEngines<Item>): OperationSummary {
  merge.filter([{ field: "id", exclude: REMOVE_IDS }]);
  return runRepeatedReadWorkloadMerge(merge, REMOVE_QUERY, FILTER_CRITERIA);
}

function runDeleteNative(runtime: NativeRuntime): OperationSummary {
  nativeMutableExclude(runtime, REMOVE_IDS);
  return runRepeatedReadWorkloadNative(runtime, REMOVE_QUERY, "kyiv", [
    ...FILTER_STATUSES,
  ]);
}

function verifyScenarios(): void {
  const addMerge = createMergeRuntime();
  warmMergeRuntime(addMerge);
  const addNative = createNativeRuntime();
  runAddMerge(addMerge);
  runAddNative(addNative);
  verifyOperationParity("add()", addMerge, addNative, ADD_QUERY, [
    { field: "city", values: [ADD_CITY] },
    { field: "status", values: [ADD_STATUS] },
  ]);

  const updateMerge = createMergeRuntime();
  warmMergeRuntime(updateMerge);
  const updateNative = createNativeRuntime();
  runUpdateMerge(updateMerge);
  runUpdateNative(updateNative);
  verifyOperationParity("update()", updateMerge, updateNative, UPDATE_QUERY, [
    { field: "city", values: [UPDATE_CITY] },
    { field: "status", values: [UPDATE_STATUS] },
  ]);

  const deleteMerge = createMergeRuntime();
  warmMergeRuntime(deleteMerge);
  const deleteNative = createNativeRuntime();
  runDeleteMerge(deleteMerge);
  runDeleteNative(deleteNative);
  verifyOperationParity(
    "mutable exclude delete",
    deleteMerge,
    deleteNative,
    REMOVE_QUERY,
    FILTER_CRITERIA,
  );
}

function runScenario(
  scenario: string,
  setup: () => void,
  fn: () => OperationSummary,
): ScenarioResult {
  const round = (value: number) => Math.round(value * 100) / 100;
  const nowMs = (): number => Number(process.hrtime.bigint()) / 1_000_000;

  console.log(`Running ${scenario}...`);

  for (let warmup = 0; warmup < WARMUP_RUNS; warmup++) {
    setup();
    fn();
  }

  globalThis.gc?.();

  setup();
  const memBefore = heapMB();
  const summary = fn();
  const memAfter = heapMB();
  const memory_mb = Math.round(Math.max(0, memAfter - memBefore) * 100) / 100;
  globalThis.gc?.();

  const times: number[] = [];
  for (let run = 0; run < MEASURE_RUNS; run++) {
    setup();
    const start = nowMs();
    fn();
    times.push(nowMs() - start);
  }

  times.sort((left, right) => left - right);

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
    result_count: summary.resultCount,
    checksum: summary.checksum,
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
  printBenchHeader("controls-bench", {
    metricsLabel:
      "p50 / p95 / p99 latency for mutation + immediate read workload (lower is better)",
  });

  verifyScenarios();
  console.log(
    "Parity check: MergeEngines and native controls produced identical datasets and read results.",
  );

  let mergeRuntime: MergeEngines<Item>;
  let nativeRuntime: NativeRuntime;

  const results = [
    runScenario(
      "A1. MergeEngines.add() - append 2 items + immediate search/filter/sort read",
      () => {
        mergeRuntime = createMergeRuntime();
        warmMergeRuntime(mergeRuntime);
      },
      () => runAddMerge(mergeRuntime),
    ),
    runScenario(
      "A2. Native Array/Map add - append 2 items + immediate linear search/filter/sort read",
      () => {
        nativeRuntime = createNativeRuntime();
      },
      () => runAddNative(nativeRuntime),
    ),
    runScenario(
      "B1. MergeEngines.update() - refresh 1 item + immediate search/filter/sort read",
      () => {
        mergeRuntime = createMergeRuntime();
        warmMergeRuntime(mergeRuntime);
      },
      () => runUpdateMerge(mergeRuntime),
    ),
    runScenario(
      "B2. Native Array/Map update - replace 1 item + immediate linear search/filter/sort read",
      () => {
        nativeRuntime = createNativeRuntime();
      },
      () => runUpdateNative(nativeRuntime),
    ),
    runScenario(
      "C1. MergeEngines mutable exclude - remove 10 ids + immediate search/filter/sort read",
      () => {
        mergeRuntime = createMergeRuntime();
        warmMergeRuntime(mergeRuntime);
      },
      () => runDeleteMerge(mergeRuntime),
    ),
    runScenario(
      "C2. Native Array/Map swap-pop delete - remove 10 ids + immediate linear search/filter/sort read",
      () => {
        nativeRuntime = createNativeRuntime();
      },
      () => runDeleteNative(nativeRuntime),
    ),
  ];

  const comparisonRows: TableRow[] = [
    {
      label: "A — add 2 items, then read once",
      engineMs: results[0].p50_ms,
      nativeMs: results[1].p50_ms,
      speedup: speedupStr(results[1].p50_ms, results[0].p50_ms),
    },
    {
      label: "B — update 1 item, then read once",
      engineMs: results[2].p50_ms,
      nativeMs: results[3].p50_ms,
      speedup: speedupStr(results[3].p50_ms, results[2].p50_ms),
    },
    {
      label: "C — delete 10 ids via mutable exclude, then read once",
      engineMs: results[4].p50_ms,
      nativeMs: results[5].p50_ms,
      speedup: speedupStr(results[5].p50_ms, results[4].p50_ms),
    },
  ];

  printComparisonTable(
    "MergeEngines controls vs Native Array/Map — Performance Comparison (100k items)",
    comparisonRows,
  );

  printLatencyTable(
    "Per-scenario tail latency",
    results.map(
      (result): LatencyTableRow => ({
        scenario: result.scenario,
        p50_ms: result.p50_ms,
        p95_ms: result.p95_ms,
        p99_ms: result.p99_ms,
        max_ms: result.max_ms,
      }),
    ),
  );

  const failed = results
    .filter((result) => result.status === "FAIL")
    .map((result) => result.scenario);

  if (failed.length === 0) {
    console.log("\n✅  All control scenarios passed all thresholds.");
  } else {
    console.log(`\n❌  Failed: ${failed.join(" | ")}`);
    process.exitCode = 1;
  }
}

main().catch(console.error);
