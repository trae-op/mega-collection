# JavaScript Guide: Optimizing Large Data Iteration with Nested Collections

## The Problem with Nested Iterations

### Anti-Pattern: Nested Loops

```
const users = [...];
const orders = [...];
const products = [...];

const result = users.map(user => ({
  ...user,
  orders: orders.filter(order => order.userId === user.id).map(order => ({
    ...order,
    products: products.filter(product =>
      order.productIds.includes(product.id)
    )
  }))
}));
```

Complexity: O(n × m × k)

- 10,000 users × 50,000 orders × 100,000 products = catastrophic performance
- Memory allocation multiplies with each nested iteration
- Causes browser freezing and memory overflow

---

## Core Optimization Principles

### Rule 1: Index Before Iterate

Convert arrays to Maps/Objects for O(1) lookup instead of O(n) filtering.

### Rule 2: Reduce Nesting Depth

Flatten data structures whenever possible.

### Rule 3: Process in Chunks

Don't load everything into memory at once.

### Rule 4: Use Lazy Evaluation

Process data only when needed using generators.

### Rule 5: Avoid Redundant Iterations

Cache results, use memoization, pre-compute where possible.

---

## Data Indexing Strategy

### Pattern: Pre-Index Collections

**Before (O(n²)):**

```
const getUserOrders = (userId) => {
  return orders.filter(order => order.userId === userId);
};

users.forEach(user => {
  const userOrders = getUserOrders(user.id);
});
```

**After (O(n)):**

```
const ordersByUserId = new Map();

orders.forEach(order => {
  if (!ordersByUserId.has(order.userId)) {
    ordersByUserId.set(order.userId, []);
  }
  ordersByUserId.get(order.userId).push(order);
});

users.forEach(user => {
  const userOrders = ordersByUserId.get(user.id) || [];
});
```

### Pattern: Multi-Level Indexing

```
const createIndexes = (users, orders, products) => {
  const ordersByUserId = new Map();
  const productsByOrderId = new Map();
  const productsById = new Map();

  products.forEach(product => {
    productsById.set(product.id, product);
  });

  orders.forEach(order => {
    if (!ordersByUserId.has(order.userId)) {
      ordersByUserId.set(order.userId, []);
    }
    ordersByUserId.get(order.userId).push(order);

    const orderProducts = order.productIds
      .map(id => productsById.get(id))
      .filter(Boolean);

    productsByOrderId.set(order.id, orderProducts);
  });

  return { ordersByUserId, productsByOrderId, productsById };
};

const indexes = createIndexes(users, orders, products);

const enrichedUsers = users.map(user => ({
  ...user,
  orders: (indexes.ordersByUserId.get(user.id) || []).map(order => ({
    ...order,
    products: indexes.productsByOrderId.get(order.id) || []
  }))
}));
```

**Complexity Reduction:** O(n × m × k) → O(n + m + k)

---

## Flat Map Instead of Nested Loops

### Pattern: Flatten Then Process

**Before:**

```
const result = [];
categories.forEach(category => {
  category.products.forEach(product => {
    product.variants.forEach(variant => {
      if (variant.inStock) {
        result.push({
          categoryId: category.id,
          productId: product.id,
          variant
        });
      }
    });
  });
});
```

**After:**

```
const result = categories.flatMap(category =>
  category.products.flatMap(product =>
    product.variants
      .filter(variant => variant.inStock)
      .map(variant => ({
        categoryId: category.id,
        productId: product.id,
        variant
      }))
  )
);
```

### Pattern: Single Pass Processing

```
const processNestedData = (data) => {
  const stack = [{ items: data, path: [] }];
  const results = [];

  while (stack.length > 0) {
    const { items, path } = stack.pop();

    items.forEach(item => {
      const currentPath = [...path, item.id];

      if (item.children?.length > 0) {
        stack.push({ items: item.children, path: currentPath });
      }

      results.push({
        path: currentPath,
        data: item
      });
    });
  }

  return results;
};
```

---

## Iterators and Generators

### Pattern: Lazy Evaluation with Generators

```
function* flattenNested(items, getChildren) {
  for (const item of items) {
    yield item;

    const children = getChildren(item);
    if (children?.length > 0) {
      yield* flattenNested(children, getChildren);
    }
  }
}

const categories = [...];
const flatItems = [...flattenNested(categories, cat => cat.subcategories)];
```

### Pattern: Paginated Processing

```
function* paginateData(data, pageSize = 1000) {
  for (let i = 0; i < data.length; i += pageSize) {
    yield data.slice(i, i + pageSize);
  }
}

const largeDataset = [...];

for (const chunk of paginateData(largeDataset, 1000)) {
  processChunk(chunk);
}
```

### Pattern: Async Generator for Large Datasets

```
async function* processLargeDataset(items, processor) {
  for (const item of items) {
    const result = await processor(item);
    yield result;
  }
}

const processItem = async (item) => {
  return {
    ...item,
    processed: true
  };
};

const results = [];
for await (const result of processLargeDataset(largeData, processItem)) {
  results.push(result);

  if (results.length % 1000 === 0) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
```

---

## Chunk Processing

### Pattern: Batch Processing with Delays

```
const processInChunks = async (data, chunkSize, processor) => {
  const results = [];

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(item => processor(item))
    );

    results.push(...chunkResults);

    if (i + chunkSize < data.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return results;
};

const enrichedData = await processInChunks(
  users,
  500,
  async (user) => ({
    ...user,
    orders: ordersByUserId.get(user.id) || []
  })
);
```

### Pattern: Progressive Results

```
const processWithProgress = async (data, processor, onProgress) => {
  const chunkSize = 100;
  const results = [];

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    const processed = chunk.map(processor);
    results.push(...processed);

    onProgress({
      processed: i + chunk.length,
      total: data.length,
      percentage: ((i + chunk.length) / data.length) * 100
    });

    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return results;
};

await processWithProgress(
  largeDataset,
  item => ({ ...item, processed: true }),
  progress => console.log(`Progress: ${progress.percentage.toFixed(2)}%`)
);
```

---

## Memoization Techniques

### Pattern: Cache Expensive Computations

```
const createMemoizedProcessor = () => {
  const cache = new Map();

  return (key, computeFn) => {
    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = computeFn();
    cache.set(key, result);
    return result;
  };
};

const memoize = createMemoizedProcessor();

const processUser = (user, orders, products) => {
  return memoize(`user-${user.id}`, () => {
    const userOrders = orders.filter(o => o.userId === user.id);
    return {
      ...user,
      orderCount: userOrders.length,
      totalSpent: userOrders.reduce((sum, o) => sum + o.total, 0)
    };
  });
};
```

### Pattern: WeakMap for Object Keys

```
const cache = new WeakMap();

const getEnrichedData = (obj, enrichFn) => {
  if (cache.has(obj)) {
    return cache.get(obj);
  }

  const enriched = enrichFn(obj);
  cache.set(obj, enriched);
  return enriched;
};
```

---

## Streaming Data Processing

### Pattern: Transform Stream

```
const createTransformStream = (transformer) => {
  let buffer = [];

  return {
    push: (item) => {
      buffer.push(item);

      if (buffer.length >= 100) {
        return this.flush();
      }
      return [];
    },

    flush: () => {
      const results = buffer.map(transformer);
      buffer = [];
      return results;
    }
  };
};

const stream = createTransformStream(item => ({
  ...item,
  processed: true
}));

const processStream = (data) => {
  const results = [];

  data.forEach(item => {
    const processed = stream.push(item);
    results.push(...processed);
  });

  results.push(...stream.flush());
  return results;
};
```

### Pattern: Observable Pattern

```
const createDataObservable = (data, chunkSize = 100) => {
  const subscribers = [];

  return {
    subscribe: (callback) => {
      subscribers.push(callback);
      return () => {
        const index = subscribers.indexOf(callback);
        if (index > -1) subscribers.splice(index, 1);
      };
    },

    process: async () => {
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);

        for (const subscriber of subscribers) {
          await subscriber(chunk);
        }

        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  };
};

const observable = createDataObservable(largeDataset, 500);
const results = [];

observable.subscribe(chunk => {
  results.push(...chunk.map(item => ({ ...item, processed: true })));
});

await observable.process();
```

---

## Web Workers for Heavy Computation

### Pattern: Offload to Worker

**Main Thread:**

```
const worker = new Worker('data-processor.js');

const processInWorker = (data) => {
  return new Promise((resolve) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.postMessage({ type: 'PROCESS', data });
  });
};

const result = await processInWorker(largeDataset);
```

**Worker (data-processor.js):**

```
self.onmessage = (e) => {
  if (e.data.type === 'PROCESS') {
    const result = e.data.data.map(item => ({
      ...item,
      computed: heavyComputation(item)
    }));

    self.postMessage(result);
  }
};

const heavyComputation = (item) => {
  return item.values.reduce((acc, val) => acc + val, 0);
};
```

### Pattern: Worker Pool

```
const createWorkerPool = (workerScript, poolSize = 4) => {
  const workers = Array.from(
    { length: poolSize },
    () => new Worker(workerScript)
  );
  let currentWorker = 0;

  return {
    execute: (data) => {
      return new Promise((resolve) => {
        const worker = workers[currentWorker];
        currentWorker = (currentWorker + 1) % poolSize;

        worker.onmessage = (e) => resolve(e.data);
        worker.postMessage(data);
      });
    },

    terminate: () => {
      workers.forEach(worker => worker.terminate());
    }
  };
};

const pool = createWorkerPool('processor.js', 4);

const processInParallel = async (data, chunkSize = 1000) => {
  const chunks = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }

  const results = await Promise.all(
    chunks.map(chunk => pool.execute(chunk))
  );

  return results.flat();
};

const result = await processInParallel(largeDataset);
pool.terminate();
```

---

## Performance Comparison Table

| Approach         | Time Complexity   | Space Complexity | Best For               | Drawbacks                   |
| ---------------- | ----------------- | ---------------- | ---------------------- | --------------------------- |
| Nested Loops     | O(n × m × k)      | O(n × m × k)     | Small datasets         | Catastrophic for large data |
| Indexing         | O(n + m + k)      | O(n + m + k)     | Frequent lookups       | Upfront memory cost         |
| Flat Map         | O(n + m + k)      | O(n + m + k)     | Single pass processing | Less readable               |
| Generators       | O(n)              | O(1)             | Memory-constrained     | Slower overall              |
| Chunk Processing | O(n)              | O(chunk size)    | Browser responsiveness | Adds complexity             |
| Memoization      | O(n) + cache hits | O(cache size)    | Repeated computations  | Memory overhead             |
| Web Workers      | O(n/workers)      | O(n/workers)     | Heavy computation      | Setup overhead              |
| Streaming        | O(n)              | O(buffer size)   | Real-time data         | Complex implementation      |

---

## Decision Tree

```
START: Need to process large nested data
│
├─ Data structure known upfront?
│  ├─ YES → Use Indexing Strategy
│  └─ NO → Use Generators/Streaming
│
├─ Need real-time UI updates?
│  ├─ YES → Use Chunk Processing
│  └─ NO → Process all at once
│
├─ Heavy computation per item?
│  ├─ YES → Use Web Workers
│  └─ NO → Main thread is fine
│
├─ Repeated access to same data?
│  ├─ YES → Use Memoization
│  └─ NO → Direct processing
│
└─ Memory constrained?
   ├─ YES → Use Generators + Chunks
   └─ NO → Indexing + Batch processing
```

---

## Complete Example: E-commerce Data Processing

```
const optimizedDataProcessor = () => {
  const createIndexes = (products, orders, customers) => {
    const productMap = new Map(products.map(p => [p.id, p]));
    const ordersByCustomer = new Map();
    const productsByOrder = new Map();

    orders.forEach(order => {
      if (!ordersByCustomer.has(order.customerId)) {
        ordersByCustomer.set(order.customerId, []);
      }
      ordersByCustomer.get(order.customerId).push(order);

      const orderProducts = order.items
        .map(item => ({
          ...productMap.get(item.productId),
          quantity: item.quantity
        }))
        .filter(p => p.id);

      productsByOrder.set(order.id, orderProducts);
    });

    return { productMap, ordersByCustomer, productsByOrder };
  };

  const processInChunks = async (customers, indexes, chunkSize = 500) => {
    const results = [];

    for (let i = 0; i < customers.length; i += chunkSize) {
      const chunk = customers.slice(i, i + chunkSize);

      const processed = chunk.map(customer => ({
        ...customer,
        orders: (indexes.ordersByCustomer.get(customer.id) || []).map(order => ({
          ...order,
          products: indexes.productsByOrder.get(order.id) || []
        }))
      }));

      results.push(...processed);

      if (i + chunkSize < customers.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    return results;
  };

  return { createIndexes, processInChunks };
};

const processor = optimizedDataProcessor();
const indexes = processor.createIndexes(products, orders, customers);
const enrichedCustomers = await processor.processInChunks(customers, indexes);
```

---

## Key Takeaways for AI Agents

1. **Always index before iterating** - Convert O(n²) to O(n) with Maps
2. **Avoid nested loops** - Use indexing, flat maps, or generators
3. **Process in chunks** - Keep browser responsive with setTimeout(0)
4. **Use generators for memory** - Lazy evaluation saves RAM
5. **Memoize expensive operations** - Cache repeated computations
6. **Offload heavy work** - Use Web Workers for CPU-intensive tasks
7. **Measure first** - Profile before optimizing
8. **Trade space for time** - Indexing uses more memory but drastically faster

---

## Anti-Patterns to Avoid

❌ **Never do this:**

```
array1.forEach(item1 => {
  array2.forEach(item2 => {
    array3.forEach(item3 => {
      if (item1.id === item2.ref && item2.id === item3.ref) {
        result.push({ item1, item2, item3 });
      }
    });
  });
});
```

✅ **Do this instead:**

```
const map2 = new Map(array2.map(item => [item.ref, item]));
const map3 = new Map(array3.map(item => [item.ref, item]));

const result = array1
  .map(item1 => {
    const item2 = map2.get(item1.id);
    const item3 = item2 ? map3.get(item2.id) : null;
    return item2 && item3 ? { item1, item2, item3 } : null;
  })
  .filter(Boolean);
```
