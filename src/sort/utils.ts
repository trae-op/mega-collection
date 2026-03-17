// ---------------------------------------------------------------------------
// Radix-sort helpers (LSD, 2-pass, base 2^16)
// ---------------------------------------------------------------------------

import type { CollectionItem } from "../types";
import type { SortIndex, SortRuntime } from "./types";

/**
 * Returns true if every value in `values` is a non-negative 32-bit integer,
 * i.e. it can be treated as a Uint32 without precision loss.
 */
export function canUseUint32Radix(values: Float64Array, n: number): boolean {
  for (let i = 0; i < n; i++) {
    const v = values[i];
    // v >>> 0 converts to Uint32; equality fails for negatives, floats, or v > 2^32-1
    if (v !== v >>> 0) return false;
  }
  return true;
}

/**
 * 2-pass LSD radix sort — sorts `indexes` so that `values[indexes[i]]` is
 * non-decreasing.  Requires all values to be in [0, 2^32-1] integers.
 *
 * Time  O(2n + 2·65536)  ≈ O(n)
 * Space O(n + 65536)     for temp buffer + count array
 */
export function radixSortUint32(
  indexes: Uint32Array,
  values: Float64Array,
  n: number,
): void {
  const temp = new Uint32Array(n);
  const count = new Uint32Array(65536);

  // Pass 1 — lower 16 bits
  for (let i = 0; i < n; i++) count[values[indexes[i]] & 0xffff]++;
  let s = 0;
  for (let i = 0; i < 65536; i++) {
    const c = count[i];
    count[i] = s;
    s += c;
  }
  for (let i = 0; i < n; i++) {
    const b = values[indexes[i]] & 0xffff;
    temp[count[b]++] = indexes[i];
  }

  // Pass 2 — upper 16 bits
  count.fill(0);
  for (let i = 0; i < n; i++) count[(values[temp[i]] >>> 16) & 0xffff]++;
  s = 0;
  for (let i = 0; i < 65536; i++) {
    const c = count[i];
    count[i] = s;
    s += c;
  }
  for (let i = 0; i < n; i++) {
    const b = (values[temp[i]] >>> 16) & 0xffff;
    indexes[count[b]++] = temp[i];
  }
}

// ---------------------------------------------------------------------------

export const createSortRuntime = <
  T extends CollectionItem,
>(): SortRuntime<T> => ({
  indexedFields: new Set<keyof T & string>(),
  cache: new Map<string, SortIndex<T>>(),
});
