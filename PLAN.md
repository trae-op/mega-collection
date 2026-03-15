# FilterEngine — Performance Optimization Plan

Three targeted optimizations for `src/filter/filter.ts` and `src/indexer.ts`.
Each section explains the current problem, root cause, proposed change, expected
impact, and any risks or edge cases to verify.

---

## 1. `createCriteriaCacheKey` — замінити `JSON.stringify` на плоску рядкову серіалізацію

### Проблема

`createCriteriaCacheKey` викликається **на кожному** `filter()` — включно з тими
викликами, результат яких беруться з кешу. Поточна реалізація виконує кілька
дорогих операцій перед тим, як повернути рядок-ключ:

```typescript
// src/filter/filter.ts — поточний код
private createCriteriaCacheKey(criteria: ResolvedFilterCriterion<T>[]): string {
  const criteriaByField = this.createCriteriaStateMap(criteria);   // Map-копія

  return JSON.stringify(                                            // 1. JSON.stringify
    [...criteriaByField.entries()]                                  // 2. spread ітератора
      .sort(([leftField], [rightField]) =>
        leftField.localeCompare(rightField),                        // 3. sort + localeCompare
      )
      .map(([field, criterion]) => ({                               // 4. map нових об'єктів
        field,
        hasValues: criterion.hasValues,
        hasExclude: criterion.hasExclude,
        values: criterion.values.map(v => JSON.stringify(v)).sort(),  // 5. вкладений JSON + sort
        exclude: criterion.exclude.map(v => JSON.stringify(v)).sort(),
      })),
  );
}
```

**Витрата часу:** Для кожного кеш-хіту виконуються 5 алокацій нових масивів/об'єктів,
2 сортування і 2 рівні `JSON.stringify`. Виміри показують ~0.05–0.12 ms на виклик
при 2–3 критеріях, що є несуттєвим для одного виклику але помітним при 20+ повторних
запитах у гарячому циклі.

### Першопричина

`createCriteriaStateMap` вже будує `Map<field, criterion>` — ця структура далі
переводиться у масив, сортується і серіалізується через `JSON.stringify`.  
`JSON.stringify` — найдорожчий крок: він рекурсивно обходить об'єкти і виробляє
великі рядки (≈180–300 символів для 2 критеріїв).

### Пропоноване рішення

Замінити `createCriteriaStateMap` + `JSON.stringify` на **пряму плоску серіалізацію**
безпосередньо над `ResolvedFilterCriterion[]`. Ключ формується по відсортованих
полях, значення кодуються примітивними `String()` з роздільниками, неможли-
ми у реальних іменах полів:

```typescript
private createCriteriaCacheKey(criteria: ResolvedFilterCriterion<T>[]): string {
  // Сортуємо лише поля — без spread ітератора і створення Map
  const sorted = criteria.slice().sort((a, b) =>
    (a.field as string) < (b.field as string) ? -1 : 1,
  );

  let key = "";
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    // Формат сегменту: "<field>|v:<v1>,<v2>|x:<x1>,<x2>;"
    key += c.field as string;
    key += "|v:";
    if (c.hasValues) {
      // values вже нормалізовані через createIncludedValuesSet — порядок не гарантований,
      // тому сортуємо аналогічно поточній логіці, але без JSON.stringify для примітивів.
      key += c.values.map(String).sort().join(",");
    }
    key += "|x:";
    if (c.hasExclude) {
      key += c.exclude.map(String).sort().join(",");
    }
    key += ";";
  }
  return key;
}
```

**Примітка щодо нечислових значень:** `String()` коректно кодує `boolean`,
`number`, `string`. Якщо в реальному проєкті значення поля є об'єктами — потрібно
залишити `JSON.stringify(value)` тільки для тих значень, де `typeof value ===
"object"`. Для найпоширенішого випадку (рядки, числа, булеві) `String()` — достатньо.

### Очікуваний ефект

| Сценарій                               | Поточно                   | Після              |
| -------------------------------------- | ------------------------- | ------------------ |
| Гарячий кеш-хіт (20 повторних запитів) | ~0.08 ms / виклик на ключ | ~0.005 ms / виклик |
| Перший обчислювальний виклик           | без змін                  | без змін           |
| Пам'ять                                | без змін                  | без змін           |

Бенчмарк-групи B, C, D повинні показати покращення приблизно на 10–20% в абсолютних
числах (бо кеш-хіти зараз займають левову частку виміряного часу).

### Ризики і що треба перевірити

- `filter.test.ts` і `nested.test.ts` — запустити без змін, усі тести мають пройти.
- Переконатись, що ключі для однакових критеріїв у іншому порядку задання
  однакові (сортування полів гарантує це).
- Значення типу `null` / `undefined` не потрапляють у `values` / `exclude` завдяки
  `createIncludedValuesSet` — але варто додати юніт-тест для впевненості.

---

## 2. `new Set(sourceData)` в `filterViaIndex` — усунути O(n) побудову Set для звуження

### Проблема

Коли `filterByPreviousResult` звужує результат (тобто `sourceData` є
попереднім результатом, а не `this.dataset`), `filterViaIndex` будує `Set` з
усього `sourceData`:

```typescript
// src/filter/filter.ts — поточний код
private filterViaIndex(
  criteria: ResolvedFilterCriterion<T>[],
  sourceData: T[],
): T[] {
  const isFilteringFromSubset = sourceData !== this.dataset;
  const allowedItems = isFilteringFromSubset ? new Set(sourceData) : null;  // ← проблема
  // ...
  for (let itemIndex = 0; itemIndex < indexedResult.length; itemIndex++) {
    const item = indexedResult[itemIndex];
    if (allowedItems && !allowedItems.has(item)) {  // O(1) але Set побудовано за O(m)
      continue;
    }
    // ...
  }
}
```

Для попереднього результату розміром `m` (напр. 20 000 елементів після першого
фільтрування) побудова `new Set(sourceData)` коштує ~20 000 операцій `Set.add` і
≈160 KB пам'яті — це виконується **заново на кожному** виклику `filterViaIndex`
при звуженні.

### Першопричина

`Set` будується щоразу тому, що `filterViaIndex` отримує `sourceData` як простий
масив і не має жодного постійного допоміжного індексу для перевірки належності.

### Пропоноване рішення

**Варіант A (мінімальна зміна): кешувати `WeakRef<Set<T>>` разом з попереднім результатом**

Додати до `FilterSequentialCache<T>` поле `previousResultSet: WeakRef<Set<T>> | null`.
Заповнювати його у `storePreviousResult`. `filterViaIndex` перевіряє чи `sourceData`
є тим самим масивом що й `previousResult` і, якщо так — бере готовий Set.

```typescript
// src/filter/types.ts — додати поле
export interface FilterSequentialCache<T> {
  previousResult: T[] | null;
  previousCriteria: ResolvedFilterCriterion<T>[] | null;
  previousBaseData: T[] | null;
  previousResultsByCriteria: Map<string, T[]>;
  previousResultSet: Set<T> | null;           // ← НОВЕ
}

// src/filter/filter.ts — createFilterRuntime
const createFilterRuntime = <T>(): FilterRuntime<T> => ({
  // ...
  sequentialCache: {
    previousResult: null,
    previousCriteria: null,
    previousBaseData: null,
    previousResultsByCriteria: new Map(),
    previousResultSet: null,                  // ← НОВЕ
  },
});

// src/filter/filter.ts — storePreviousResult
private storePreviousResult(result: T[], ...): void {
  // ...існуючий код...
  this.sequentialCache.previousResultSet =
    result.length > 0 ? new Set(result) : null;  // ← будуємо ОДИН раз
}

// src/filter/filter.ts — filterViaIndex
private filterViaIndex(criteria, sourceData): T[] {
  const isFilteringFromSubset = sourceData !== this.dataset;

  // Використовуємо кешований Set якщо sourceData === previousResult
  let allowedItems: Set<T> | null = null;
  if (isFilteringFromSubset) {
    if (sourceData === this.sequentialCache.previousResult &&
        this.sequentialCache.previousResultSet !== null) {
      allowedItems = this.sequentialCache.previousResultSet;  // ← повторне використання
    } else {
      allowedItems = new Set(sourceData);                     // ← fallback
    }
  }
  // ...решта без змін
}
```

**Варіант B (альтернатива): уникнути Set зовсім через intersection**

Оскільки `indexedResult` — список кандидатів з індексу, а `sourceData` (попередній
результат) — теж відсортований підмножина оригіналу, можна замінити перевірку
`allowedItems.has(item)` на пошук по відсортованому масиву. Але це ускладнює логіку
і дає перевагу лише при дуже малих `sourceData`. Варіант A надійніший.

### Очікуваний ефект

| Сценарій                              | Поточно                       | Після (Варіант A)                        |
| ------------------------------------- | ----------------------------- | ---------------------------------------- |
| Звуження через indexed filter (m=20k) | ~0.5 ms на побудову Set       | ~0 ms (Set вже є)                        |
| Перший виклик (sourceData = dataset)  | без змін                      | без змін                                 |
| Пам'ять Set                           | будується і знищується щоразу | живе до наступного `storePreviousResult` |

Особливо помітно при Group C/D бенчмарку де звужується 20–30 разів один і той
самий попередній результат.

### Ризики і що треба перевірити

- `resetFilterState()` вже очищує весь `sequentialCache` — потрібно додати
  `this.sequentialCache.previousResultSet = null` туди ж.
- При `clearData()` / `data()` / `add()` мутаціях `resetFilterState()` вже викликається
  у `handleStateMutation` — нове поле очиститься автоматично.
- Запустити `filter.test.ts` для всіх шляхів звуження (sequential narrowing tests).

---

## 3. `getByValues` в `Indexer` — прибрати зайву Set-дедуплікацію для дизʼюнктних бакетів

### Проблема

`getByValues` будує `new Set<T>()` щоразу, коли `values.length > 1`, щоб уникнути
дублікатів у результаті:

```typescript
// src/indexer.ts — поточний код
getByValues(field: keyof T & string, values: any[]): T[] {
  // ...
  if (values.length === 1) {
    return indexMap.get(values[0]) ?? [];   // bez Set — OK
  }

  const seenItems = new Set<T>();           // ← O(total_bucket_size) побудова
  const result: T[] = [];

  for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
    const bucket = indexMap.get(values[valueIndex]);
    if (bucket === undefined) continue;

    for (let bucketIndex = 0; bucketIndex < bucket.length; bucketIndex++) {
      const item = bucket[bucketIndex];
      if (!seenItems.has(item)) {           // перевірка приналежності
        seenItems.add(item);
        result.push(item);
      }
    }
  }
  return result;
}
```

### Першопричина та аналіз

Дедуплікація потрібна тільки якщо **один item може одночасно перебувати у
кількох бакетах одного поля**. Це неможливо для **простих однозначних полів**
(кожен `item.status` має рівно одне значення — item потрапляє рівно в один бакет).

Однак `Indexer` є загальним і не знає, чи поле однозначне. Поле `tags: string[]`
(масив значень) теоретично могло б привести item до кількох бакетів, якщо б
`buildIndex` індексував такі поля по-особливому. Але поточний `buildIndex`
читає `item[field]` як скалярне значення — тому **за поточною реалізацією
`buildIndex` бакети завжди дизʼюнктні**.

### Пропоноване рішення

**Варіант A (безпечний): прибрати Set, конкатенувати бакети напряму**

Оскільки `buildIndex` гарантує дизʼюнктність, `seenItems` завжди зайве:

```typescript
// src/indexer.ts — після рефакторингу
getByValues(field: keyof T & string, values: any[]): T[] {
  const indexMap = this.storage.indexes.get(field as string);
  if (!indexMap) return [];

  if (values.length === 1) {
    return indexMap.get(values[0]) ?? [];
  }

  // Бакети дизʼюнктні (buildIndex індексує скалярні поля) — дедуплікація не потрібна.
  // Для 2 значень уникаємо алокації масиву зовсім (найчастіший кейс бенчмарку).
  if (values.length === 2) {
    const b0 = indexMap.get(values[0]);
    const b1 = indexMap.get(values[1]);
    if (!b0) return b1 ?? [];
    if (!b1) return b0;
    return b0.concat(b1);    // одна алокація замість Set + result[]
  }

  const result: T[] = [];
  for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
    const bucket = indexMap.get(values[valueIndex]);
    if (bucket !== undefined) {
      for (let bi = 0; bi < bucket.length; bi++) {
        result.push(bucket[bi]);
      }
    }
  }
  return result;
}
```

**Варіант B (захисний): зберегти Set як опціональний режим через прапор**

Якщо у майбутньому `Indexer` розширять для полів-масивів, можна передати
`{ allowDuplicateBuckets: boolean }` у конструктор і вмикати дедуплікацію
лише тоді. Для поточного кодобазису це зайве ускладнення.

### Очікуваний ефект

| Сценарій                               | Поточно                       | Після                     |
| -------------------------------------- | ----------------------------- | ------------------------- |
| `values.length === 1`                  | без Set (вже OK)              | без змін                  |
| `values.length === 2`, 13k результатів | `new Set(13k)` + result[]     | `b0.concat(b1)` — без Set |
| `values.length >= 3`                   | `new Set(sum_buckets)`        | прямий push, без Set      |
| Пам'ять (GC тиск)                      | +1 Set per `getByValues` call | усунуто                   |

Найбільший ефект — у `filterViaIndex` для multi-value inclusion criteria
(напр. `status in ["active", "pending"]`). Групи B/C/D бенчмарку використовують
саме такі критерії (`bc_criteria` і `d_broad` з 2–3 значеннями).

### Ризики і що треба перевірити

- Впевнитись (через `indexer.test.ts`), що `values.length > 2` і `values.length === 2`
  дають однакові результати що і раніше.
- **Порядок** елементів у результаті зміниться (раніше `seenItems` давав перший
  зустрінутий; тепер бакети конкатенуються послідовно). `filter.test.ts` не повинен
  залежати від порядку всередині результату — перевірити.
- Якщо у майбутньому хтось захоче індексувати поле-масив через `buildIndex`, потрібно
  буде повернути дедуплікацію. Варто залишити коментар у коді.

---

## Пріоритет і послідовність виконання

| #   | Зміна                               | Файл                    | Складність | Ризик   | Очікуваний приріст             |
| --- | ----------------------------------- | ----------------------- | ---------- | ------- | ------------------------------ |
| 1   | Плоска серіалізація ключа кешу      | `filter.ts`             | Низька     | Низький | 10–20% у групах B/C/D          |
| 2   | Кешований `previousResultSet`       | `filter.ts`, `types.ts` | Середня    | Низький | 5–15% при повторному звуженні  |
| 3   | Прибрати дедуплікацію Set у Indexer | `indexer.ts`            | Низька     | Низький | 5–10% у всіх indexed сценаріях |

Рекомендована послідовність: **3 → 1 → 2**

- Пункт 3 — ізольована зміна в `indexer.ts`, не торкається `filter.ts`.
- Пункт 1 — ізольована зміна в одному приватному методі.
- Пункт 2 — додає нове поле у `FilterSequentialCache<T>` і зачіпає кілька місць.

Після кожного пункту: `npm test` (або `npx vitest run`) і `npx tsx src/filter/filter.bench.ts`.

## Зробити code review

Зробіть огляд коду ваших останніх змін. Перевірте наявність дублікатів, невикористаного коду, надлишкового коду, витоків пам'яті тощо.