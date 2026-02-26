# Writing Professional Tests for JavaScript/TypeScript NPM Packages

## Overview

This guide provides a structured instruction set for AI agents on how to write professional, maintainable tests for NPM packages with ~80% code coverage. All examples use **TypeScript**, **Vitest** (preferred modern alternative to Jest), and follow industry best practices.

---

## 1. Tech Stack Selection

### Recommended Stack (2024–2025)

| Tool                          | Purpose                                             |
| ----------------------------- | --------------------------------------------------- |
| **Vitest**                    | Test runner (fast, ESM-native, Jest-compatible API) |
| **@vitest/coverage-v8**       | Code coverage via V8                                |
| **@testing-library/jest-dom** | DOM matchers (if testing UI utilities)              |
| **msw**                       | Mock Service Worker for HTTP mocking                |
| **zod**                       | Schema validation in tests                          |

### Why Vitest over Jest?

- Native ESM support
- Blazing fast (uses Vite under the hood)
- Zero-config TypeScript support
- Jest-compatible API (easy migration)

---

## 2. Project Structure

```
my-npm-package/
├── src/
│   ├── index.ts
│   ├── utils/
│   │   ├── formatters.ts
│   │   └── validators.ts
│   └── types.ts
├── tests/
│   ├── unit/
│   │   ├── formatters.test.ts
│   │   └── validators.test.ts
│   ├── integration/
│   │   └── index.test.ts
│   ├── fixtures/
│   │   └── data.ts
│   └── helpers/
│       └── setup.ts
├── vitest.config.ts
├── package.json
└── tsconfig.json
```

### Rules for AI Agent:

- Place unit tests next to the module or in `tests/unit/`
- Place integration tests in `tests/integration/`
- Place shared mock data in `tests/fixtures/`
- Place test utilities and helpers in `tests/helpers/`

---

## 3. Configuration

### `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      exclude: ["node_modules/**", "tests/**", "**/*.d.ts", "vitest.config.ts"],
    },
    include: ["tests/**/*.test.ts"],
  },
});
```

### `package.json` scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "@vitest/ui": "^2.0.0"
  }
}
```

---

## 4. Test File Anatomy

Every test file must follow this structure:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { functionUnderTest } from "../../src/utils/formatters";

describe("functionUnderTest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when input is valid", () => {
    it("should return formatted result", () => {
      const result = functionUnderTest("input");
      expect(result).toBe("expected");
    });
  });

  describe("when input is invalid", () => {
    it("should throw an error", () => {
      expect(() => functionUnderTest("")).toThrow("Error message");
    });
  });
});
```

### Naming Rules for AI Agent:

- `describe` block → name of the module/function/class
- Nested `describe` → the scenario/condition
- `it` block → starts with `"should ..."` describing expected behavior

---

## 5. Unit Testing Patterns

### 5.1 Pure Functions

```typescript
import { describe, it, expect } from "vitest";
import { formatCurrency } from "../../src/utils/formatters";

describe("formatCurrency", () => {
  describe("when given a valid number", () => {
    it("should format USD by default", () => {
      expect(formatCurrency(1000)).toBe("$1,000.00");
    });

    it("should format with custom currency code", () => {
      expect(formatCurrency(1000, "EUR")).toBe("€1,000.00");
    });

    it("should handle zero", () => {
      expect(formatCurrency(0)).toBe("$0.00");
    });

    it("should handle negative numbers", () => {
      expect(formatCurrency(-500)).toBe("-$500.00");
    });
  });

  describe("when given invalid input", () => {
    it("should throw TypeError for NaN", () => {
      expect(() => formatCurrency(NaN)).toThrow(TypeError);
    });

    it("should throw RangeError for Infinity", () => {
      expect(() => formatCurrency(Infinity)).toThrow(RangeError);
    });
  });
});
```

### 5.2 Classes

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "../../src/EventEmitter";

describe("EventEmitter", () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  describe("on()", () => {
    it("should register an event listener", () => {
      const handler = vi.fn();
      emitter.on("click", handler);
      emitter.emit("click", { x: 10 });
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({ x: 10 });
    });
  });

  describe("off()", () => {
    it("should remove a registered listener", () => {
      const handler = vi.fn();
      emitter.on("click", handler);
      emitter.off("click", handler);
      emitter.emit("click", {});
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
```

### 5.3 Async Functions

```typescript
import { describe, it, expect, vi } from "vitest";
import { fetchUser } from "../../src/api/users";

describe("fetchUser", () => {
  it("should resolve with user data", async () => {
    const user = await fetchUser(1);
    expect(user).toMatchObject({
      id: 1,
      name: expect.any(String),
    });
  });

  it("should reject when user is not found", async () => {
    await expect(fetchUser(9999)).rejects.toThrow("User not found");
  });
});
```

---

## 6. Mocking Strategies

### 6.1 Mocking Modules

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendEmail } from "../../src/notifications";
import * as mailer from "../../src/lib/mailer";

vi.mock("../../src/lib/mailer");

describe("sendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call mailer.send with correct params", async () => {
    const sendMock = vi
      .spyOn(mailer, "send")
      .mockResolvedValue({ success: true });

    await sendEmail("user@example.com", "Hello");

    expect(sendMock).toHaveBeenCalledWith({
      to: "user@example.com",
      body: "Hello",
    });
  });
});
```

### 6.2 Mocking HTTP Requests (with msw)

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { getPost } from "../../src/api/posts";

const server = setupServer(
  http.get("https://api.example.com/posts/:id", ({ params }) => {
    return HttpResponse.json({ id: params.id, title: "Mock Post" });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("getPost", () => {
  it("should return post data from API", async () => {
    const post = await getPost("1");
    expect(post).toEqual({ id: "1", title: "Mock Post" });
  });

  it("should handle 404 response", async () => {
    server.use(
      http.get("https://api.example.com/posts/:id", () => {
        return HttpResponse.json({ error: "Not found" }, { status: 404 });
      }),
    );

    await expect(getPost("999")).rejects.toThrow("Not found");
  });
});
```

### 6.3 Mocking Timers

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "../../src/utils/debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should delay function execution", () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 300);

    debouncedFn();
    debouncedFn();
    debouncedFn();

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(fn).toHaveBeenCalledOnce();
  });
});
```

---

## 7. Integration Tests

Integration tests verify that multiple modules work together correctly.

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../../src/index";

describe("NPM Package Integration", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp({ debug: false });
  });

  afterAll(() => {
    app.destroy();
  });

  it("should initialize with default config", () => {
    expect(app.getConfig()).toMatchObject({
      debug: false,
      version: expect.any(String),
    });
  });

  it("should process pipeline end-to-end", async () => {
    const result = await app.process({ input: "raw data" });
    expect(result).toMatchObject({
      status: "success",
      output: expect.any(String),
    });
  });
});
```

---

## 8. Edge Cases — Checklist for AI Agent

When writing tests, always cover these edge cases:

### Input Edge Cases

- Empty string `""`
- `null` and `undefined`
- `0`, `-0`, `NaN`, `Infinity`, `-Infinity`
- Empty array `[]` and empty object `{}`
- Deeply nested objects
- Arrays with mixed types
- Very large numbers or strings
- Unicode characters and emojis

### Async Edge Cases

- Network timeout
- Concurrent calls (race conditions)
- Retry logic
- Partial failures

### Example:

```typescript
describe("parseJSON", () => {
  it("should return null for empty string", () => {
    expect(parseJSON("")).toBeNull();
  });

  it("should handle deeply nested objects", () => {
    const deep = JSON.stringify({ a: { b: { c: { d: 42 } } } });
    expect(parseJSON(deep)).toEqual({ a: { b: { c: { d: 42 } } } });
  });

  it("should return null for invalid JSON", () => {
    expect(parseJSON("{invalid}")).toBeNull();
  });

  it("should handle unicode characters", () => {
    expect(parseJSON('"héllo wörld 🌍"')).toBe("héllo wörld 🌍");
  });
});
```

---

## 9. Test Fixtures

Centralize mock data in fixtures to keep tests DRY.

```typescript
// tests/fixtures/data.ts

export const mockUser = {
  id: 1,
  name: "John Doe",
  email: "john@example.com",
  createdAt: new Date("2024-01-01"),
};

export const mockUserList = Array.from({ length: 5 }, (_, i) => ({
  ...mockUser,
  id: i + 1,
  name: `User ${i + 1}`,
}));

export const invalidUser = {
  id: -1,
  name: "",
  email: "not-an-email",
};
```

Usage in tests:

```typescript
import { mockUser, invalidUser } from "../fixtures/data";

describe("validateUser", () => {
  it("should pass validation for valid user", () => {
    expect(validateUser(mockUser)).toBe(true);
  });

  it("should fail validation for invalid user", () => {
    expect(validateUser(invalidUser)).toBe(false);
  });
});
```

---

## 10. Custom Test Helpers

```typescript
// tests/helpers/setup.ts

import { vi } from "vitest";

export const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

export const waitFor = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const createAsyncMock = <T>(value: T, delay = 0) =>
  vi
    .fn()
    .mockImplementation(() =>
      delay
        ? new Promise<T>((r) => setTimeout(() => r(value), delay))
        : Promise.resolve(value),
    );
```

---

## 11. Coverage Strategy: Reaching 80%

### What to prioritize (high ROI):

1. **All public API functions** → 100% coverage target
2. **Error handling paths** → All `catch` blocks and thrown errors
3. **Conditional branches** → All `if/else`, ternary operators
4. **Utility functions** → Pure functions are easiest to test

### What can be excluded:

```typescript
// vitest.config.ts
coverage: {
  exclude: [
    "src/types.ts", // Type-only files
    "src/constants.ts", // Simple constant exports
    "src/index.ts", // Re-export barrel files
    "**/*.d.ts",
  ];
}
```

### Coverage Report Reading:

```
File              | % Stmts | % Branch | % Funcs | % Lines
------------------|---------|----------|---------|--------
src/formatters.ts |   92.3  |   85.7   |  100.0  |  91.8
src/validators.ts |   78.5  |   72.2   |   88.9  |  79.1
```

- **Stmts** → every executable statement
- **Branch** → every `if/else` path
- **Funcs** → every function called at least once
- **Lines** → every line executed

---

## 12. Common Anti-Patterns to Avoid

| Anti-Pattern                       | Problem                     | Solution                       |
| ---------------------------------- | --------------------------- | ------------------------------ |
| Testing implementation details     | Tests break on refactor     | Test public behavior/output    |
| One giant test file                | Hard to maintain            | One file per module            |
| Hardcoded values in multiple tests | Hard to update              | Use fixtures                   |
| No `beforeEach` cleanup            | State leaking between tests | Always reset mocks             |
| Testing third-party code           | Wastes time                 | Mock external dependencies     |
| `it("does something")`             | Vague names                 | `it("should return X when Y")` |
| Skipping error paths               | Low branch coverage         | Always test unhappy paths      |

---

## 13. Full Example: Real-World NPM Package

### Source: `src/utils/validators.ts`

```typescript
export const isEmail = (value: string): boolean => {
  if (!value || typeof value !== "string") return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(value.trim());
};

export const isURL = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};
```

### Tests: `tests/unit/validators.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { isEmail, isURL } from "../../src/utils/validators";

describe("isEmail", () => {
  describe("when given a valid email", () => {
    it("should return true for simple email", () => {
      expect(isEmail("user@example.com")).toBe(true);
    });

    it("should return true for email with subdomain", () => {
      expect(isEmail("user@mail.example.co.uk")).toBe(true);
    });

    it("should return true with leading/trailing spaces", () => {
      expect(isEmail("  user@example.com  ")).toBe(true);
    });
  });

  describe("when given an invalid email", () => {
    it("should return false for missing @", () => {
      expect(isEmail("userexample.com")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isEmail("")).toBe(false);
    });

    it("should return false for null-like non-string", () => {
      expect(isEmail(null as unknown as string)).toBe(false);
    });

    it("should return false for email with spaces", () => {
      expect(isEmail("user @example.com")).toBe(false);
    });
  });
});

describe("isURL", () => {
  describe("when given a valid URL", () => {
    it("should return true for https URL", () => {
      expect(isURL("https://example.com")).toBe(true);
    });

    it("should return true for URL with path and query", () => {
      expect(isURL("https://example.com/path?q=1&page=2")).toBe(true);
    });

    it("should return true for localhost", () => {
      expect(isURL("http://localhost:3000")).toBe(true);
    });
  });

  describe("when given an invalid URL", () => {
    it("should return false for plain string", () => {
      expect(isURL("not a url")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isURL("")).toBe(false);
    });

    it("should return false for missing protocol", () => {
      expect(isURL("example.com")).toBe(false);
    });
  });
});
```

---

## 14. Quick Reference Checklist for AI Agent

Before finishing test generation, verify:

- [ ] Each public function has at least one test
- [ ] Happy path is tested
- [ ] Error/edge cases are tested
- [ ] Async functions use `async/await`
- [ ] All mocks are cleared in `beforeEach`/`afterEach`
- [ ] No hardcoded test data (use fixtures)
- [ ] Descriptive `describe` and `it` names
- [ ] `vitest.config.ts` has coverage thresholds set to 80
- [ ] No tests for private/internal helpers (unless critical)
- [ ] Integration tests cover the main public API surface

---

_Guide version: 2025 | Stack: Vitest 2.x + TypeScript 5.x_
