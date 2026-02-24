# JavaScript Loops Best Practices

> **Purpose:** This guide provides professional patterns for writing high-performance loops in JavaScript/TypeScript, with a focus on avoiding expensive O(n²) nested operations.

---

## 1. Core Principle: Understand Time Complexity First

Before writing any loop, classify the problem:

| Complexity | Description                 | Acceptable?          |
| ---------- | --------------------------- | -------------------- |
| O(n)       | Single pass over data       | ✅ Always            |
| O(n log n) | Sort-based solutions        | ✅ Usually           |
| O(n²)      | Nested loops over same data | ⚠️ Avoid if n > 1000 |
| O(n³)      | Triple nested loops         | ❌ Almost never      |

**Rule:** If you find yourself writing a loop inside a loop over the same dataset — stop and look for a Map/Set/sort-based alternative.

---

## 2. Replace Nested Loops with Hash Maps (O(n²) → O(n))

### ❌ Naive — O(n²)

```typescript
const findPair = (arr: number[], target: number): [number, number] | null => {
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] + arr[j] === target) return [arr[i], arr[j]];
    }
  }
  return null;
};
```

### ✅ Optimal — O(n)

```typescript
const findPair = (arr: number[], target: number): [number, number] | null => {
  const seen = new Map<number, boolean>();

  for (const num of arr) {
    const complement = target - num;
    if (seen.has(complement)) return [complement, num];
    seen.set(num, true);
  }

  return null;
};
```

**Technique:** Pre-build a lookup structure (Map/Set/object) in one pass, then query it in a second pass. Two O(n) passes = O(n) total.

---

## 3. Pre-compute Lookups Before the Loop

### ❌ Nested lookup inside loop — O(n²)

```typescript
const getEnrichedUsers = (users: TUser[], roles: TRole[]): TEnrichedUser[] =>
  users.map((user) => ({
    ...user,
    role: roles.find((r) => r.id === user.roleId),
  }));
```

### ✅ Pre-compute Map — O(n)

```typescript
const getEnrichedUsers = (users: TUser[], roles: TRole[]): TEnrichedUser[] => {
  const roleMap = new Map(roles.map((r) => [r.id, r]));

  return users.map((user) => ({
    ...user,
    role: roleMap.get(user.roleId),
  }));
};
```

**Rule:** Never call `.find()`, `.filter()`, or `.includes()` inside a loop over a large array. Pre-build a Map before the loop.

---

## 4. Flatten Genuinely Required Nested Loops

When nested loops are truly necessary (e.g., matrix operations), minimize work inside the inner loop.

### ❌ Repeated property access inside inner loop

```typescript
const multiplyMatrices = (a: number[][], b: number[][]): number[][] => {
  const result: number[][] = [];
  for (let i = 0; i < a.length; i++) {
    result[i] = [];
    for (let j = 0; j < b[0].length; j++) {
      let sum = 0;
      for (let k = 0; k < b.length; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
};
```

### ✅ Cache row references — reduces property lookups

```typescript
const multiplyMatrices = (a: number[][], b: number[][]): number[][] => {
  const rows = a.length;
  const cols = b[0].length;
  const shared = b.length;
  const result: number[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(0),
  );

  for (let i = 0; i < rows; i++) {
    const rowA = a[i];
    const rowResult = result[i];
    for (let k = 0; k < shared; k++) {
      const valA = rowA[k];
      const rowB = b[k];
      for (let j = 0; j < cols; j++) {
        rowResult[j] += valA * rowB[j];
      }
    }
  }

  return result;
};
```

**Technique:** Cache array row references outside inner loops. Avoid repeated `arr[i]` property access — use `const row = arr[i]` once.

---

## 5. Use Sort + Two Pointers Instead of Nested Loops

For problems involving pairs/triplets with a condition, sort first, then use pointers.

### ❌ Nested — O(n²)

```typescript
const hasPairWithSum = (arr: number[], target: number): boolean => {
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] + arr[j] === target) return true;
    }
  }
  return false;
};
```

### ✅ Sort + Two Pointers — O(n log n)

```typescript
const hasPairWithSum = (arr: number[], target: number): boolean => {
  const sorted = [...arr].sort((a, b) => a - b);
  let left = 0;
  let right = sorted.length - 1;

  while (left < right) {
    const sum = sorted[left] + sorted[right];
    if (sum === target) return true;
    if (sum < target) left++;
    else right--;
  }

  return false;
};
```

---

## 6. Use Set for Existence Checks — O(1) Lookup

### ❌ Array `.includes()` inside loop — O(n²)

```typescript
const filterUnique = (a: string[], b: string[]): string[] =>
  a.filter((item) => b.includes(item));
```

### ✅ Set lookup — O(n)

```typescript
const filterUnique = (a: string[], b: string[]): string[] => {
  const setB = new Set(b);
  return a.filter((item) => setB.has(item));
};
```

**Rule:** `Set.has()` = O(1). `Array.includes()` = O(n). Always convert to Set before checking membership inside a loop.

---

## 7. Group with reduce / Map Before Joining Data

### ❌ Nested scan to join — O(n²)

```typescript
const joinOrdersToUsers = (
  users: TUser[],
  orders: TOrder[],
): TUserWithOrders[] =>
  users.map((user) => ({
    ...user,
    orders: orders.filter((o) => o.userId === user.id),
  }));
```

### ✅ Group first — O(n)

```typescript
const joinOrdersToUsers = (
  users: TUser[],
  orders: TOrder[],
): TUserWithOrders[] => {
  const ordersByUser = orders.reduce<Map<string, TOrder[]>>((acc, order) => {
    const list = acc.get(order.userId) ?? [];
    list.push(order);
    acc.set(order.userId, list);
    return acc;
  }, new Map());

  return users.map((user) => ({
    ...user,
    orders: ordersByUser.get(user.id) ?? [],
  }));
};
```

---

## 8. Early Exit and Short-Circuit

Always exit loops as early as possible. Use `break`, `return`, and guard clauses.

### ❌ Full scan even when answer is found

```typescript
const hasAdmin = (users: TUser[]): boolean => {
  let found = false;
  users.forEach((user) => {
    if (user.role === "admin") found = true;
  });
  return found;
};
```

### ✅ Early return

```typescript
const hasAdmin = (users: TUser[]): boolean => {
  for (const user of users) {
    if (user.role === "admin") return true;
  }
  return false;
};
```

**Rule:** `Array.some()` / `Array.every()` short-circuit by design — use them over `forEach` when you need a boolean result.

```typescript
const hasAdmin = (users: TUser[]): boolean =>
  users.some((user) => user.role === "admin");
```

---

## 9. Memoize Expensive Computations Inside Loops

If an inner computation is deterministic and expensive, cache its result.

### ❌ Recomputing same value repeatedly

```typescript
const processItems = (items: TItem[]): TResult[] =>
  items.map((item) => ({
    ...item,
    normalized: heavyNormalize(item.category),
  }));
```

### ✅ Memoize with Map

```typescript
const processItems = (items: TItem[]): TResult[] => {
  const cache = new Map<string, string>();

  const memoNormalize = (key: string): string => {
    if (!cache.has(key)) cache.set(key, heavyNormalize(key));
    return cache.get(key)!;
  };

  return items.map((item) => ({
    ...item,
    normalized: memoNormalize(item.category),
  }));
};
```

---

## 10. Chunk Large Loops for Non-Blocking Execution

For large datasets in a browser/Node.js environment, avoid blocking the event loop.

### ✅ Process in async chunks

```typescript
const processInChunks = async <T>(
  items: T[],
  chunkSize: number,
  processor: (item: T) => void,
): Promise<void> => {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    chunk.forEach(processor);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
```

---

## 11. Prefer Functional Iteration with Correct Method

Choose the right array method for the job:

| Goal                     | Method       | Notes                         |
| ------------------------ | ------------ | ----------------------------- |
| Transform each item      | `.map()`     | Returns new array             |
| Filter items             | `.filter()`  | Returns subset                |
| Single accumulated value | `.reduce()`  | Flexible but misuse is common |
| Boolean check (any)      | `.some()`    | Short-circuits ✅             |
| Boolean check (all)      | `.every()`   | Short-circuits ✅             |
| Side effects only        | `.forEach()` | No return value               |
| Flat + transform         | `.flatMap()` | Avoids double pass            |
| Need index + early exit  | `for...of`   | Most flexible                 |
| Pure index iteration     | `for` loop   | Fastest for typed arrays      |

---

## 12. Use TypedArrays for Numerical Loops

For heavy numerical processing, `Float64Array` / `Int32Array` are significantly faster than regular arrays.

```typescript
const sumLargeDataset = (data: Float64Array): number => {
  let total = 0;
  for (let i = 0; i < data.length; i++) {
    total += data[i];
  }
  return total;
};
```

---

## Quick Decision Checklist for AI Agents

```
Is there a loop inside a loop?
  └─ YES → Can I pre-build a Map/Set lookup? → YES → Do it (O(n²) → O(n))
            Can I sort + use two pointers?    → YES → Do it (O(n²) → O(n log n))
            Is it a matrix/grid problem?      → YES → Cache row refs, reorder loops for cache locality
  └─ NO  → Is there .find()/.filter()/.includes() inside a loop?
              └─ YES → Pre-build Map/Set before the loop

Does the loop run to completion even when answer is found early?
  └─ YES → Add early exit / use .some() / .every()

Is an expensive function called with repeated arguments inside the loop?
  └─ YES → Memoize with Map before the loop

Is the dataset very large (>100k items) in a UI context?
  └─ YES → Process in async chunks to avoid blocking
```

---

## Summary

| Pattern                        | Complexity Gain                          |
| ------------------------------ | ---------------------------------------- |
| Map/Set pre-lookup             | O(n²) → O(n)                             |
| Sort + two pointers            | O(n²) → O(n log n)                       |
| Group with reduce before join  | O(n²) → O(n)                             |
| Cache row refs in matrix loops | O(n³) constant factor ↓                  |
| Memoize inner computations     | O(n \* m) → O(n + unique_m)              |
| Early exit / `.some()`         | O(n) worst → O(1) best                   |
| Set for membership checks      | O(n²) → O(n)                             |
| TypedArrays for numbers        | Same complexity, much faster in practice |

> **Golden Rule:** If n > 1,000 — nested loops are unacceptable unless mathematically unavoidable. Always reach for a Map, Set, or sort-based solution first.
