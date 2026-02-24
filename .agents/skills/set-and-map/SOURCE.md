# JavaScript `Set` & `Map` — Professional Usage Guide

> A comprehensive best-practices manual for using `new Set` and `new Map` efficiently in modern JavaScript/TypeScript.

---

## Table of Contents

1. [Overview & When to Use](#overview)
2. [Set — Core Concepts](#set-core)
3. [Set — Best Practices](#set-best-practices)
4. [Set — Performance Patterns](#set-performance)
5. [Map — Core Concepts](#map-core)
6. [Map — Best Practices](#map-best-practices)
7. [Map — Performance Patterns](#map-performance)
8. [Set vs Map vs Array vs Object](#comparison)
9. [Advanced Patterns](#advanced)
10. [TypeScript Integration](#typescript)
11. [Common Mistakes to Avoid](#mistakes)
12. [Using Set & Map Inside Loops — Complexity Deep Dive](#loops)

---

## 1. Overview & When to Use <a name="overview"></a>

| Structure | Best For                                                                 |
| --------- | ------------------------------------------------------------------------ |
| `Set`     | Unique values, membership checks, deduplication                          |
| `Map`     | Key-value pairs with any key type, ordered iteration, frequent mutations |
| `Array`   | Ordered lists, index-based access, transformation pipelines              |
| `Object`  | Static records, JSON serialization, prototype-based patterns             |

**Rule of thumb:** If you find yourself using an `Object` as a dictionary or an `Array` for uniqueness checks — switch to `Map` or `Set`.

---

## 2. Set — Core Concepts <a name="set-core"></a>

`Set` stores **unique values** of any type. Equality is determined by the [SameValueZero](https://tc39.es/ecma262/#sec-samevaluezero) algorithm.

```typescript
const ids = new Set<number>([1, 2, 3, 2, 1]);
// Result: Set { 1, 2, 3 } — duplicates removed automatically

ids.add(4); // O(1)
ids.has(2); // O(1) — true
ids.delete(3); // O(1)
ids.size; // 3
```

### Iteration

```typescript
const tags = new Set<string>(["ts", "js", "node"]);

for (const tag of tags) {
  console.log(tag);
}

tags.forEach((tag) => console.log(tag));

const tagArray = [...tags];
const tagArray2 = Array.from(tags);
```

---

## 3. Set — Best Practices <a name="set-best-practices"></a>

### ✅ Use Set for O(1) membership checks instead of Array.includes

```typescript
// ❌ Bad — O(n) lookup
const allowedRoles = ["admin", "editor", "viewer"];
const isAllowed = allowedRoles.includes(userRole);

// ✅ Good — O(1) lookup
const allowedRoles = new Set<string>(["admin", "editor", "viewer"]);
const isAllowed = allowedRoles.has(userRole);
```

### ✅ Deduplicate arrays idiomatically

```typescript
// ❌ Verbose
const unique = arr.filter((v, i, a) => a.indexOf(v) === i);

// ✅ Clean and O(n)
const unique = [...new Set(arr)];
```

### ✅ Use Set for mathematical set operations

```typescript
const setA = new Set<number>([1, 2, 3, 4]);
const setB = new Set<number>([3, 4, 5, 6]);

const union = new Set<number>([...setA, ...setB]);
const intersection = new Set<number>([...setA].filter((x) => setB.has(x)));
const difference = new Set<number>([...setA].filter((x) => !setB.has(x)));
const symmetricDiff = new Set<number>([
  ...[...setA].filter((x) => !setB.has(x)),
  ...[...setB].filter((x) => !setA.has(x)),
]);
```

### ✅ Track visited/processed items efficiently

```typescript
const visited = new Set<string>();

const processNode = (id: string, graph: Record<string, string[]>) => {
  if (visited.has(id)) return;
  visited.add(id);
  graph[id]?.forEach((neighbor) => processNode(neighbor, graph));
};
```

### ✅ Use WeakSet for object membership without memory leaks

```typescript
const processed = new WeakSet<object>();

const processOnce = (obj: object) => {
  if (processed.has(obj)) return;
  processed.add(obj);
  // process...
};
```

---

## 4. Set — Performance Patterns <a name="set-performance"></a>

### Batch initialization is faster than repeated `.add()`

```typescript
// ❌ Slower — multiple add calls
const s = new Set<number>();
items.forEach((item) => s.add(item));

// ✅ Faster — single constructor call
const s = new Set<number>(items);
```

### Avoid converting back to Array unless necessary

```typescript
// ❌ Unnecessary conversion
const hasItem = [...mySet].includes(item);

// ✅ Direct check
const hasItem = mySet.has(item);
```

### Pre-size awareness — Sets grow dynamically but rehash under the hood

For very large datasets (100k+ items), initializing with the full iterable is more memory-efficient than incrementally adding items.

---

## 5. Map — Core Concepts <a name="map-core"></a>

`Map` stores **key-value pairs** where keys can be **any value** (including objects, functions, and primitives). Iteration order is guaranteed by insertion order.

```typescript
const userCache = new Map<string, User>();

userCache.set("u_001", { id: "u_001", name: "Alice" });
userCache.get("u_001"); // O(1)
userCache.has("u_001"); // O(1)
userCache.delete("u_001"); // O(1)
userCache.size; // number of entries
```

### Iteration

```typescript
const scores = new Map<string, number>([
  ["Alice", 95],
  ["Bob", 87],
]);

for (const [key, value] of scores) {
  console.log(key, value);
}

scores.forEach((value, key) => console.log(key, value));

const keys = [...scores.keys()];
const values = [...scores.values()];
const entries = [...scores.entries()];
```

---

## 6. Map — Best Practices <a name="map-best-practices"></a>

### ✅ Use Map instead of Object for dynamic key-value stores

```typescript
// ❌ Bad — prototype pollution risk, limited key types
const cache: Record<string, any> = {};
cache["__proto__"] = "oops";

// ✅ Good — safe, any key type
const cache = new Map<string, unknown>();
```

### ✅ Use object keys with Map (impossible with plain Object)

```typescript
type TRequest = { url: string; method: string };

const requestCache = new Map<TRequest, Response>();
const req = { url: "/api/users", method: "GET" };

requestCache.set(req, await fetch(req.url));
requestCache.get(req); // works by reference identity
```

### ✅ Implement efficient caching / memoization

```typescript
const memoize = <TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
) => {
  const cache = new Map<string, TResult>();
  return (...args: TArgs): TResult => {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key)!;
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
};
```

### ✅ Count frequencies with Map

```typescript
const countFrequency = <T>(items: T[]): Map<T, number> => {
  return items.reduce((acc, item) => {
    acc.set(item, (acc.get(item) ?? 0) + 1);
    return acc;
  }, new Map<T, number>());
};

const freq = countFrequency(["a", "b", "a", "c", "b", "a"]);
// Map { 'a' => 3, 'b' => 2, 'c' => 1 }
```

### ✅ Group items with Map

```typescript
const groupBy = <T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> => {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    const group = acc.get(key) ?? [];
    group.push(item);
    acc.set(key, group);
    return acc;
  }, new Map<K, T[]>());
};

const grouped = groupBy(users, (u) => u.role);
// Map { 'admin' => [...], 'editor' => [...] }
```

### ✅ Use Map.get with nullish coalescing for safe defaults

```typescript
// ❌ Risky — fails if value is 0, false, or ""
const value = map.get(key) || defaultValue;

// ✅ Safe
const value = map.get(key) ?? defaultValue;
```

### ✅ Use WeakMap for private object data without memory leaks

```typescript
const privateData = new WeakMap<object, { secret: string }>();

class SecureToken {
  constructor(secret: string) {
    privateData.set(this, { secret });
  }

  verify(input: string) {
    return privateData.get(this)?.secret === input;
  }
}
```

---

## 7. Map — Performance Patterns <a name="map-performance"></a>

### Map vs Object for frequent mutations

`Map` outperforms plain `Object` when keys are added/deleted frequently because it's optimized for dynamic operations.

```typescript
// ✅ Use Map for hot-path mutation scenarios
const eventHandlers = new Map<string, Set<() => void>>();

const on = (event: string, handler: () => void) => {
  const handlers = eventHandlers.get(event) ?? new Set();
  handlers.add(handler);
  eventHandlers.set(event, handlers);
};

const emit = (event: string) => {
  eventHandlers.get(event)?.forEach((h) => h());
};
```

### Bulk initialization from entries

```typescript
// ✅ Initialize from array of tuples
const map = new Map<string, number>([
  ["a", 1],
  ["b", 2],
  ["c", 3],
]);

// ✅ Convert Object to Map
const obj = { a: 1, b: 2 };
const map = new Map(Object.entries(obj));

// ✅ Convert Map back to Object
const obj = Object.fromEntries(map);
```

### Avoid .get() + .set() anti-pattern — use helper

```typescript
// ❌ Verbose pattern
if (!map.has(key)) {
  map.set(key, []);
}
map.get(key)!.push(value);

// ✅ Clean helper
const getOrSet = <K, V>(map: Map<K, V>, key: K, defaultFactory: () => V): V => {
  if (!map.has(key)) map.set(key, defaultFactory());
  return map.get(key)!;
};

getOrSet(map, key, () => []).push(value);
```

---

## 8. Set vs Map vs Array vs Object <a name="comparison"></a>

| Feature             | Set        | Map       | Array        | Object        |
| ------------------- | ---------- | --------- | ------------ | ------------- |
| Key type            | value only | any       | number index | string/Symbol |
| Unique keys         | ✅ always  | ✅ always | ❌           | ❌            |
| Insertion order     | ✅         | ✅        | ✅           | ✅ (ES2015+)  |
| `.has()` / lookup   | O(1)       | O(1)      | O(n)         | O(1)          |
| Iteration           | ✅         | ✅        | ✅           | ✅ (via keys) |
| Size property       | `.size`    | `.size`   | `.length`    | manual        |
| Memory (large data) | efficient  | efficient | efficient    | overhead      |
| JSON serializable   | ❌         | ❌        | ✅           | ✅            |

---

## 9. Advanced Patterns <a name="advanced"></a>

### LRU Cache using Map (insertion-order guaranteed)

```typescript
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.capacity) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, value);
  }
}
```

### Observable Map (reactive store)

```typescript
type TListener<V> = (value: V, key: string) => void;

class ObservableMap<V> {
  private data = new Map<string, V>();
  private listeners = new Set<TListener<V>>();

  set(key: string, value: V) {
    this.data.set(key, value);
    this.listeners.forEach((fn) => fn(value, key));
  }

  get(key: string) {
    return this.data.get(key);
  }

  subscribe(fn: TListener<V>) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
```

### Bidirectional Map

```typescript
class BiMap<K, V> {
  private forward = new Map<K, V>();
  private backward = new Map<V, K>();

  set(key: K, value: V) {
    this.forward.set(key, value);
    this.backward.set(value, key);
  }

  getByKey(key: K) {
    return this.forward.get(key);
  }
  getByValue(value: V) {
    return this.backward.get(value);
  }

  deleteByKey(key: K) {
    const value = this.forward.get(key);
    if (value !== undefined) this.backward.delete(value);
    this.forward.delete(key);
  }
}
```

### Graph representation with Map + Set

```typescript
type TGraph = Map<string, Set<string>>;

const createGraph = (): TGraph => new Map();

const addEdge = (graph: TGraph, from: string, to: string): void => {
  if (!graph.has(from)) graph.set(from, new Set());
  if (!graph.has(to)) graph.set(to, new Set());
  graph.get(from)!.add(to);
};

const bfs = (graph: TGraph, start: string): string[] => {
  const visited = new Set<string>();
  const queue: string[] = [start];
  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    result.push(node);
    graph.get(node)?.forEach((neighbor) => queue.push(neighbor));
  }

  return result;
};
```

---

## 10. TypeScript Integration <a name="typescript"></a>

### Generic type constraints

```typescript
type TCache<K extends string | number | symbol, V> = {
  store: Map<K, V>;
  ttl: number;
};

type TUniqueCollection<T extends { id: string }> = {
  items: Set<T["id"]>;
  data: Map<T["id"], T>;
};
```

### Type-safe Map serialization/deserialization

```typescript
type TSerializedMap<K, V> = [K, V][];

const serializeMap = <K, V>(map: Map<K, V>): TSerializedMap<K, V> => [
  ...map.entries(),
];

const deserializeMap = <K, V>(entries: TSerializedMap<K, V>): Map<K, V> =>
  new Map(entries);
```

### Readonly Map and Set

```typescript
type TReadonlyMap<K, V> = ReadonlyMap<K, V>;
type TReadonlySet<T> = ReadonlySet<T>;

const createImmutableConfig = (
  config: Record<string, string>,
): TReadonlyMap<string, string> => new Map(Object.entries(config));
```

---

## 11. Common Mistakes to Avoid <a name="mistakes"></a>

### ❌ Using object as Map key expecting value equality

```typescript
const map = new Map<object, string>();
map.set({ id: 1 }, "Alice");
map.get({ id: 1 }); // undefined — different reference!

// ✅ Use primitive key or store reference
const key = { id: 1 };
map.set(key, "Alice");
map.get(key); // "Alice"
```

### ❌ Mutating a Set/Map while iterating

```typescript
// ❌ Dangerous
for (const item of mySet) {
  if (condition(item)) mySet.delete(item); // may cause issues
}

// ✅ Safe — collect first, then mutate
const toDelete = [...mySet].filter(condition);
toDelete.forEach((item) => mySet.delete(item));
```

### ❌ Using JSON.stringify/parse on Map/Set

```typescript
// ❌ Data loss
JSON.stringify(new Map([["a", 1]])); // "{}"

// ✅ Custom serialization
const mapToJSON = <K, V>(map: Map<K, V>) => [...map.entries()];
const jsonToMap = <K, V>(entries: [K, V][]) => new Map(entries);
```

### ❌ Using `.get()!` without checking `.has()`

```typescript
// ❌ Unsafe non-null assertion
const value = map.get(key)!.property;

// ✅ Guard with has() or optional chaining
const value = map.get(key)?.property;
```

### ❌ Comparing two Sets/Maps directly

```typescript
// ❌ Always false — reference comparison
new Set([1, 2]) === new Set([1, 2]);

// ✅ Deep equality helper
const setsEqual = <T>(a: Set<T>, b: Set<T>): boolean =>
  a.size === b.size && [...a].every((v) => b.has(v));
```

---

## 12. Using Set & Map Inside Loops — Complexity Deep Dive <a name="loops"></a>

This is one of the most critical sections for writing performant code. The key question is:
**does using `.has()`, `.get()`, or `.add()` inside a loop cause O(n²) complexity?**

The short answer: **it depends entirely on WHERE you create the Set/Map.**

---

### The Golden Rule

> **Create the Set/Map OUTSIDE the loop. Use it INSIDE the loop.**

If you construct `new Set(...)` or `new Map(...)` **inside** a loop body — you pay O(n) construction cost on every iteration, which multiplies into **O(n²)**. If you construct it **once before** the loop — every operation inside is O(1), keeping the total at **O(n)**.

---

### Case 1 — `.has()` inside a loop ✅ Safe = O(n) total

```typescript
// ✅ O(n) — Set built once outside, .has() is O(1) per iteration
const blocklist = new Set<string>(["spam@x.com", "bot@x.com"]);

for (const user of users) {
  // O(n)
  if (blocklist.has(user.email)) {
    // O(1) ← NOT O(n)
    user.blocked = true;
  }
}
// Total: O(n)
```

Compare this to the Array version:

```typescript
// ❌ O(n²) — .includes() is O(n) per iteration
const blocklist = ["spam@x.com", "bot@x.com"];

for (const user of users) {
  // O(n)
  if (blocklist.includes(user.email)) {
    // O(n) ← scans entire array
    user.blocked = true;
  }
}
// Total: O(n²)
```

---

### Case 2 — `.get()` inside a loop ✅ Safe = O(n) total

```typescript
// ✅ O(n) — Map built once, .get() is O(1) per iteration
const rolePermissions = new Map<string, string[]>([
  ["admin", ["read", "write", "delete"]],
  ["editor", ["read", "write"]],
  ["viewer", ["read"]],
]);

for (const user of users) {
  // O(n)
  user.permissions =
    rolePermissions.get(user.role) ?? // O(1)
    [];
}
// Total: O(n)
```

---

### Case 3 — `.add()` inside a loop ✅ Safe = O(n) total

```typescript
// ✅ O(n) — accumulating unique values, .add() is O(1)
const seen = new Set<string>();
const duplicates: string[] = [];

for (const item of items) {
  // O(n)
  if (seen.has(item.id)) {
    // O(1)
    duplicates.push(item.id);
  } else {
    seen.add(item.id); // O(1)
  }
}
// Total: O(n)
```

---

### Case 4 — ❌ DANGER: constructing new Set/Map INSIDE the loop = O(n²)

```typescript
// ❌ O(n²) — new Set() construction is O(k) on every iteration
for (const user of users) {
  // O(n)
  const allowedIds = new Set<string>(activeIds); // O(k) ← rebuilds every time!
  if (allowedIds.has(user.id)) {
    process(user);
  }
}
// Total: O(n × k) ≈ O(n²) if k ~ n
```

```typescript
// ✅ O(n) — build once, reuse
const allowedIds = new Set<string>(activeIds); // O(k) — once

for (const user of users) {
  // O(n)
  if (allowedIds.has(user.id)) {
    // O(1)
    process(user);
  }
}
// Total: O(n + k) ≈ O(n)
```

---

### Case 5 — Nested loops: the most common O(n²) trap

```typescript
// ❌ O(n²) — Array approach with two nested loops
const result = usersA.filter(
  (a) => usersB.some((b) => b.id === a.id), // O(m) for each element of usersA
);
// Total: O(n × m)

// ✅ O(n + m) — build Set from one array, scan the other
const bIds = new Set<string>(usersB.map((b) => b.id)); // O(m)

const result = usersA.filter((a) => bIds.has(a.id)); // O(n) × O(1)
// Total: O(n + m)
```

---

### Case 6 — Map.set() inside a loop for aggregation ✅ O(n)

```typescript
// ✅ O(n) — building a lookup index in one pass
const userIndex = new Map<string, User>();

for (const user of users) {
  // O(n)
  userIndex.set(user.id, user); // O(1)
}

// Now all subsequent lookups are O(1) instead of O(n) search
const found = userIndex.get(targetId); // O(1)
```

---

### Case 7 — Nested Map/Set inside a loop ✅ OK if not re-created

```typescript
// ✅ OK — inner Set is created once per unique key, not per every iteration
const grouped = new Map<string, Set<string>>();

for (const tag of allTags) {
  // O(n)
  const group = grouped.get(tag.category);
  if (group) {
    group.add(tag.name); // O(1)
  } else {
    grouped.set(tag.category, new Set([tag.name])); // O(1) — created once per category
  }
}
// Total: O(n)
```

---

### Complexity Summary Table

| Pattern                                          | Complexity | Safe? |
| ------------------------------------------------ | ---------- | ----- |
| `new Set(arr)` outside loop, `.has()` inside     | O(n)       | ✅    |
| `new Map(entries)` outside loop, `.get()` inside | O(n)       | ✅    |
| `.add()` / `.set()` inside loop (accumulation)   | O(n)       | ✅    |
| `new Set(arr)` **inside** loop body              | O(n²)      | ❌    |
| `new Map(entries)` **inside** loop body          | O(n²)      | ❌    |
| `Array.includes()` inside loop                   | O(n²)      | ❌    |
| `Array.find()` inside loop                       | O(n²)      | ❌    |
| Nested loop replaced by Set lookup               | O(n + m)   | ✅    |
| Two nested loops with Array search               | O(n × m)   | ❌    |

---

### Where to Use Set & Map — Real-World Scenarios

| Scenario                          | Recommended Structure            | Why                                 |
| --------------------------------- | -------------------------------- | ----------------------------------- |
| Filter list by allowed values     | `Set` outside loop               | O(1) `.has()` vs O(n) `.includes()` |
| Deduplicate before processing     | `new Set(arr)` before loop       | Single O(n) pass                    |
| Enrich objects with related data  | `Map` index before loop          | O(1) `.get()` vs O(n) `.find()`     |
| Count occurrences while iterating | `Map` accumulator in loop        | O(1) `.get()`/`.set()`              |
| Track visited nodes (graph/tree)  | `Set` outside recursion          | Prevents O(n²) revisiting           |
| Join two data sets                | `Map`/`Set` from one, loop other | O(n + m) vs O(n × m)                |
| Permission/feature flag checks    | `Set` or `Map` at module level   | Computed once, reused forever       |
| Cache expensive lookups           | `Map` outside hot path           | One-time O(n), then O(1) per hit    |

---

### Module-level Set/Map — the most performant pattern

For static data (config, enums, allowed values) — define Set/Map at module scope so they are created exactly once during app initialization:

```typescript
const SUPPORTED_CURRENCIES = new Set<string>(["USD", "EUR", "UAH", "GBP"]);

const HTTP_STATUS_MESSAGES = new Map<number, string>([
  [200, "OK"],
  [400, "Bad Request"],
  [401, "Unauthorized"],
  [403, "Forbidden"],
  [404, "Not Found"],
  [500, "Internal Server Error"],
]);

const isValidCurrency = (code: string): boolean =>
  SUPPORTED_CURRENCIES.has(code); // O(1), no loop needed

const getStatusMessage = (status: number): string =>
  HTTP_STATUS_MESSAGES.get(status) ?? "Unknown";
```

---

### Iterating over Set/Map themselves — cost breakdown

Iterating over a Set or Map itself is always O(n) where n = number of entries. There is no hidden cost:

```typescript
const map = new Map<string, number>([
  ["a", 1],
  ["b", 2],
  ["c", 3],
]);

for (const [key, value] of map) {
} // O(n) — safe
map.forEach((v, k) => {}); // O(n) — safe
[...map.values()].map((v) => v * 2); // O(n) spread + O(n) map = O(n) total
[...map.entries()].filter(([k]) => k > 0); // O(n) — safe
```

The only thing to avoid is **spreading into an Array and then calling `.includes()`** — that recreates an O(n) structure and searches it in O(n):

```typescript
// ❌ Pointless — defeats the purpose of Set, O(n) lookup
const hasItem = [...mySet].includes(item);

// ✅ Direct O(1)
const hasItem = mySet.has(item);
```

---

```
Set
├── new Set(iterable?)       — create
├── .add(value)              — O(1)
├── .has(value)              — O(1)
├── .delete(value)           — O(1)
├── .clear()                 — O(n)
├── .size                    — O(1)
├── .forEach(fn)             — O(n)
└── [...set]                 — spread to array

Map
├── new Map(entries?)        — create
├── .set(key, value)         — O(1)
├── .get(key)                — O(1)
├── .has(key)                — O(1)
├── .delete(key)             — O(1)
├── .clear()                 — O(n)
├── .size                    — O(1)
├── .keys() / .values()      — iterators
└── .entries()               — [key, value] iterator
```
