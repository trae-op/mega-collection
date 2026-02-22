# JavaScript Best Practices Guide

## Core Principles

### Code Quality Standards

- Write clean, readable, and maintainable code
- Follow single responsibility principle for functions
- Keep functions small and focused (ideally under 20 lines)
- Use meaningful and descriptive variable names
- Avoid magic numbers and strings (use constants)
- Prefer pure functions without side effects
- Use early returns to reduce nesting

### Modern JavaScript Features

- Use ES6+ syntax exclusively
- Prefer `const` over `let`, avoid `var`
- Use template literals for string interpolation
- Destructuring for objects and arrays
- Spread operator for copying and merging
- Optional chaining (`?.`) and nullish coalescing (`??`)
- Arrow functions for callbacks and short functions

## Variable Declarations

### Const vs Let

```
const MAX_USERS = 100;
const config = { timeout: 5000 };

let counter = 0;
let result = null;
```

### Destructuring

```
const { name, age, ...rest } = user;
const [first, second, ...remaining] = items;

const { data: { results = [] } = {} } = response;
```

## Functions

### Arrow Functions

```
const add = (a, b) => a + b;

const processData = (data) => {
  const filtered = data.filter(item => item.active);
  return filtered.map(item => item.value);
};

const fetchUser = async (id) => {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
};
```

### Pure Functions

```
const calculateTotal = (items) => {
  return items.reduce((sum, item) => sum + item.price, 0);
};

const filterActive = (users) => {
  return users.filter(user => user.status === 'active');
};
```

### Function Composition

```
const compose = (...fns) => (x) => fns.reduceRight((v, f) => f(v), x);

const pipe = (...fns) => (x) => fns.reduce((v, f) => f(v), x);

const toLowerCase = (str) => str.toLowerCase();
const trim = (str) => str.trim();
const removeSpaces = (str) => str.replace(/\s+/g, '');

const normalizeString = pipe(trim, toLowerCase, removeSpaces);
```

## Data Structures

### Objects

```
const createUser = (name, age, role) => ({
  name,
  age,
  role,
  createdAt: Date.now()
});

const updateUser = (user, updates) => ({
  ...user,
  ...updates,
  updatedAt: Date.now()
});

const mergeObjects = (obj1, obj2) => ({ ...obj1, ...obj2 });
```

### Arrays

```
const uniqueItems = [...new Set(items)];

const flattenArray = (arr) => arr.flat(Infinity);

const groupBy = (array, key) => {
  return array.reduce((result, item) => {
    const group = item[key];
    result[group] = result[group] ?? [];
    result[group].push(item);
    return result;
  }, {});
};

const chunk = (array, size) => {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
};
```

### Maps and Sets

```
const cache = new Map();

const addToCache = (key, value) => {
  cache.set(key, value);
  return value;
};

const getFromCache = (key) => cache.get(key);

const uniqueValues = new Set();
items.forEach(item => uniqueValues.add(item));
```

## Performance Optimization

### Debouncing and Throttling

```
const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

const throttle = (func, limit) => {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};
```

### Memoization

```
const memoize = (fn) => {
  const cache = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
};

const expensiveCalculation = memoize((n) => {
  let result = 0;
  for (let i = 0; i < n; i++) {
    result += i;
  }
  return result;
});
```

### Lazy Evaluation

```
const createLazyValue = (computeFn) => {
  let cached;
  let computed = false;
  return () => {
    if (!computed) {
      cached = computeFn();
      computed = true;
    }
    return cached;
  };
};

const lazyExpensiveValue = createLazyValue(() => {
  return performExpensiveOperation();
});
```

## Working with Large Datasets

### Efficient Array Operations

```
const processLargeArray = (data) => {
  const result = [];
  const length = data.length;
  
  for (let i = 0; i < length; i++) {
    if (data[i].active) {
      result.push(data[i].value);
    }
  }
  
  return result;
};

const binarySearch = (arr, target) => {
  let left = 0;
  let right = arr.length - 1;
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) left = mid + 1;
    else right = mid - 1;
  }
  
  return -1;
};
```

### Batch Processing

```
const processBatch = async (items, batchSize, processor) => {
  const results = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  
  return results;
};
```

### Virtual Scrolling / Pagination

```
const getPaginatedData = (data, page, pageSize) => {
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  return data.slice(startIndex, endIndex);
};

const lazyLoadData = (getData, pageSize) => {
  let page = 1;
  let hasMore = true;
  
  return async () => {
    if (!hasMore) return null;
    
    const data = await getData(page, pageSize);
    hasMore = data.length === pageSize;
    page++;
    
    return data;
  };
};
```

### Web Workers for Heavy Computation

```
const createWorker = (workerFunction) => {
  const code = workerFunction.toString();
  const blob = new Blob([`(${code})()`], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
};

const heavyComputationWorker = () => {
  self.onmessage = (e) => {
    const result = performHeavyComputation(e.data);
    self.postMessage(result);
  };
};

const runInWorker = (data) => {
  return new Promise((resolve) => {
    const worker = createWorker(heavyComputationWorker);
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.postMessage(data);
  });
};
```

### Stream Processing

```
const processStream = async (stream, processor) => {
  const reader = stream.getReader();
  const results = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(processor(value));
  }
  
  return results;
};
```

## Asynchronous Patterns

### Promises

```
const fetchData = (url) => {
  return fetch(url)
    .then(response => response.json())
    .catch(error => {
      console.error('Fetch error:', error);
      throw error;
    });
};

const promiseAll = (promises) => Promise.all(promises);

const promiseRace = (promises) => Promise.race(promises);

const promiseAllSettled = (promises) => Promise.allSettled(promises);
```

### Async/Await

```
const fetchUserData = async (userId) => {
  try {
    const response = await fetch(`/api/users/${userId}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw error;
  }
};

const fetchMultipleUsers = async (userIds) => {
  const promises = userIds.map(id => fetchUserData(id));
  return Promise.all(promises);
};
```

### Async Iteration

```
const asyncMap = async (array, asyncFn) => {
  const results = [];
  for (const item of array) {
    results.push(await asyncFn(item));
  }
  return results;
};

const asyncFilter = async (array, asyncPredicate) => {
  const results = [];
  for (const item of array) {
    if (await asyncPredicate(item)) {
      results.push(item);
    }
  }
  return results;
};
```

## Error Handling

### Try-Catch Patterns

```
const safeExecute = (fn, fallback) => {
  try {
    return fn();
  } catch (error) {
    console.error('Execution error:', error);
    return fallback;
  }
};

const asyncSafeExecute = async (asyncFn, fallback) => {
  try {
    return await asyncFn();
  } catch (error) {
    console.error('Async execution error:', error);
    return fallback;
  }
};
```

### Custom Error Classes

```
class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class NetworkError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

const validateUser = (user) => {
  if (!user.email) {
    throw new ValidationError('Email is required', 'email');
  }
  if (!user.name) {
    throw new ValidationError('Name is required', 'name');
  }
  return true;
};
```

## Design Patterns

### Factory Pattern

```
const createUser = (type, data) => {
  const userTypes = {
    admin: (data) => ({ ...data, role: 'admin', permissions: ['all'] }),
    user: (data) => ({ ...data, role: 'user', permissions: ['read'] }),
    guest: (data) => ({ ...data, role: 'guest', permissions: [] })
  };
  
  return userTypes[type](data);
};
```

### Singleton Pattern

```
const createSingleton = (createInstance) => {
  let instance;
  
  return () => {
    if (!instance) {
      instance = createInstance();
    }
    return instance;
  };
};

const getDatabase = createSingleton(() => ({
  connect: () => console.log('Connected'),
  disconnect: () => console.log('Disconnected')
}));
```

### Observer Pattern

```
const createObservable = () => {
  const observers = new Set();
  
  return {
    subscribe: (observer) => {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    notify: (data) => {
      observers.forEach(observer => observer(data));
    }
  };
};

const eventBus = createObservable();
const unsubscribe = eventBus.subscribe((data) => console.log(data));
eventBus.notify({ type: 'UPDATE', payload: {} });
```

### Strategy Pattern

```
const createCalculator = () => {
  const strategies = {
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    multiply: (a, b) => a * b,
    divide: (a, b) => a / b
  };
  
  return {
    calculate: (operation, a, b) => {
      const strategy = strategies[operation];
      if (!strategy) {
        throw new Error(`Unknown operation: ${operation}`);
      }
      return strategy(a, b);
    }
  };
};
```

### Module Pattern

```
const createCounter = () => {
  let count = 0;
  
  return {
    increment: () => ++count,
    decrement: () => --count,
    getCount: () => count,
    reset: () => count = 0
  };
};

const counter = createCounter();
```

## Data Validation

### Input Validation

```
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const validateSchema = (data, schema) => {
  const errors = {};
  
  Object.entries(schema).forEach(([key, validator]) => {
    if (!validator(data[key])) {
      errors[key] = `Invalid value for ${key}`;
    }
  });
  
  return Object.keys(errors).length === 0 ? null : errors;
};
```

## Utility Functions

### Array Utilities

```
const sortBy = (array, key) => {
  return [...array].sort((a, b) => {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
    return 0;
  });
};

const removeDuplicates = (array, key) => {
  const seen = new Set();
  return array.filter(item => {
    const value = key ? item[key] : item;
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

const intersection = (arr1, arr2) => {
  const set = new Set(arr2);
  return arr1.filter(item => set.has(item));
};

const difference = (arr1, arr2) => {
  const set = new Set(arr2);
  return arr1.filter(item => !set.has(item));
};
```

### Object Utilities

```
const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj);
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  
  const clonedObj = {};
  Object.keys(obj).forEach(key => {
    clonedObj[key] = deepClone(obj[key]);
  });
  
  return clonedObj;
};

const deepMerge = (target, source) => {
  const output = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }
  
  return output;
};

const isObject = (item) => {
  return item && typeof item === 'object' && !Array.isArray(item);
};

const pick = (obj, keys) => {
  return keys.reduce((result, key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
    return result;
  }, {});
};

const omit = (obj, keys) => {
  const keysToOmit = new Set(keys);
  return Object.keys(obj).reduce((result, key) => {
    if (!keysToOmit.has(key)) {
      result[key] = obj[key];
    }
    return result;
  }, {});
};
```

### String Utilities

```
const capitalize = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

const camelCase = (str) => {
  return str
    .replace(/[-_\s]+(.)?/g, (_, char) => char ? char.toUpperCase() : '')
    .replace(/^[A-Z]/, char => char.toLowerCase());
};

const kebabCase = (str) => {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
};

const truncate = (str, maxLength, suffix = '...') => {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - suffix.length) + suffix;
};
```

## Memory Management

### Object Pool Pattern

```
const createObjectPool = (factory, size = 10) => {
  const pool = [];
  
  for (let i = 0; i < size; i++) {
    pool.push(factory());
  }
  
  return {
    acquire: () => {
      if (pool.length > 0) {
        return pool.pop();
      }
      return factory();
    },
    release: (obj) => {
      if (pool.length < size) {
        pool.push(obj);
      }
    }
  };
};
```

### Weak References

```
const createCache = () => {
  const cache = new WeakMap();
  
  return {
    set: (key, value) => cache.set(key, value),
    get: (key) => cache.get(key),
    has: (key) => cache.has(key)
  };
};
```

## Testing Helpers

### Mock Functions

```
const createMock = () => {
  const calls = [];
  
  const mockFn = (...args) => {
    calls.push(args);
    return mockFn.returnValue;
  };
  
  mockFn.calls = calls;
  mockFn.returnValue = undefined;
  mockFn.mockReturnValue = (value) => {
    mockFn.returnValue = value;
    return mockFn;
  };
  
  return mockFn;
};
```

## Best Practices Summary

1. **Always use const by default**, let when reassignment is needed
2. **Prefer pure functions** without side effects
3. **Use meaningful names** for variables and functions
4. **Keep functions small** and focused on single responsibility
5. **Avoid nested callbacks** - use async/await
6. **Handle errors properly** with try-catch blocks
7. **Use early returns** to reduce nesting
8. **Leverage modern JavaScript features** (destructuring, spread, optional chaining)
9. **Optimize for performance** when working with large datasets
10. **Use appropriate data structures** (Map, Set, WeakMap) for specific use cases
11. **Implement lazy loading** and pagination for large data
12. **Use memoization** for expensive computations
13. **Apply debouncing/throttling** for frequent events
14. **Consider Web Workers** for CPU-intensive tasks
15. **Write self-documenting code** with clear names and structure