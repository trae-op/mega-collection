# If/Else Best Practices in JavaScript/TypeScript

> **Purpose:** This guide defines professional patterns for writing conditional logic. The goal is maximum readability, maintainability, and zero unnecessary nesting.

---

## Core Principle: Flat is Better Than Nested

Nested conditions are the #1 enemy of readable code. Every time you nest an `if` inside another `if`, you add cognitive load. The goal is to keep the "happy path" visible and handle edge cases early.

---

## 1. Early Return (Guard Clauses)

The most powerful pattern. Instead of wrapping logic in `if`, **return early** when conditions are not met.

### ❌ Bad — nested pyramid

```typescript
function processOrder(order: TOrder | null): string {
  if (order) {
    if (order.items.length > 0) {
      if (order.isPaid) {
        return `Order ${order.id} is ready`;
      } else {
        return "Order not paid";
      }
    } else {
      return "Order has no items";
    }
  } else {
    return "No order found";
  }
}
```

### ✅ Good — guard clauses

```typescript
function processOrder(order: TOrder | null): string {
  if (!order) return "No order found";
  if (order.items.length === 0) return "Order has no items";
  if (!order.isPaid) return "Order not paid";

  return `Order ${order.id} is ready`;
}
```

---

## 2. Ternary Operator for Simple Assignments

Use ternary for single-value assignments. Avoid chaining ternaries — that is as bad as nesting.

### ❌ Bad — verbose if/else for simple assignment

```typescript
let label: string;
if (isAdmin) {
  label = "Admin";
} else {
  label = "User";
}
```

### ✅ Good — ternary

```typescript
const label = isAdmin ? "Admin" : "User";
```

### ❌ Bad — chained ternary (unreadable)

```typescript
const label = isAdmin
  ? "Admin"
  : isMod
    ? "Moderator"
    : isGuest
      ? "Guest"
      : "User";
```

### ✅ Good — use a lookup map instead (see section 4)

---

## 3. Nullish Coalescing & Optional Chaining

Replace defensive `if` checks for null/undefined with modern operators.

### ❌ Bad

```typescript
let username: string;
if (user && user.profile && user.profile.name) {
  username = user.profile.name;
} else {
  username = "Anonymous";
}
```

### ✅ Good

```typescript
const username = user?.profile?.name ?? "Anonymous";
```

---

## 4. Lookup Maps Instead of if/else Chains

When switching between values based on a key, a **lookup object/map** is cleaner and more scalable than long `if/else if` chains.

### ❌ Bad — if/else chain

```typescript
function getStatusLabel(status: TStatus): string {
  if (status === "active") return "Active";
  else if (status === "inactive") return "Inactive";
  else if (status === "pending") return "Pending";
  else if (status === "banned") return "Banned";
  else return "Unknown";
}
```

### ✅ Good — lookup map

```typescript
const STATUS_LABELS: Record<TStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  pending: "Pending",
  banned: "Banned",
};

function getStatusLabel(status: TStatus): string {
  return STATUS_LABELS[status] ?? "Unknown";
}
```

---

## 5. Strategy Pattern (Function Maps)

When different conditions require different **behaviors** (not just values), map conditions to functions.

### ❌ Bad — if/else with logic in each branch

```typescript
function handleEvent(event: TEventType, payload: TPayload): void {
  if (event === "click") {
    trackClick(payload);
    updateUI(payload);
  } else if (event === "submit") {
    validateForm(payload);
    sendToServer(payload);
  } else if (event === "scroll") {
    updateScrollPosition(payload);
    lazyLoadImages(payload);
  }
}
```

### ✅ Good — strategy map

```typescript
type TEventHandler = (payload: TPayload) => void;

const EVENT_HANDLERS: Record<TEventType, TEventHandler> = {
  click: (payload) => {
    trackClick(payload);
    updateUI(payload);
  },
  submit: (payload) => {
    validateForm(payload);
    sendToServer(payload);
  },
  scroll: (payload) => {
    updateScrollPosition(payload);
    lazyLoadImages(payload);
  },
};

function handleEvent(event: TEventType, payload: TPayload): void {
  EVENT_HANDLERS[event]?.(payload);
}
```

---

## 6. Array Methods to Replace Conditional Loops

Avoid `if` inside `for` loops. Use `.filter()`, `.map()`, `.find()`, `.some()`, `.every()`.

### ❌ Bad — if inside loop

```typescript
const result: TUser[] = [];
for (const user of users) {
  if (user.isActive) {
    result.push(user);
  }
}
```

### ✅ Good — filter

```typescript
const result = users.filter((user) => user.isActive);
```

### ❌ Bad — if inside loop for transformation

```typescript
const names: string[] = [];
for (const user of users) {
  if (user.age >= 18) {
    names.push(user.name.toUpperCase());
  }
}
```

### ✅ Good — chain filter + map

```typescript
const names = users
  .filter((user) => user.age >= 18)
  .map((user) => user.name.toUpperCase());
```

---

## 7. Combine Conditions to Reduce Branches

Group related conditions into a single well-named variable or function.

### ❌ Bad — multiple separate checks

```typescript
if (
  user.role === "admin" ||
  user.role === "superadmin" ||
  user.permissions.includes("write")
) {
  allowEdit();
}
```

### ✅ Good — extract to a named predicate

```typescript
const canEdit = (user: TUser): boolean =>
  ["admin", "superadmin"].includes(user.role) ||
  user.permissions.includes("write");

if (canEdit(user)) allowEdit();
```

---

## 8. Switch vs If/Else

Use `switch` when matching a single variable against multiple constant values. For anything more complex, prefer lookup maps (section 4).

### ✅ Acceptable — switch for simple dispatch

```typescript
switch (action.type) {
  case "INCREMENT":
    return { ...state, count: state.count + 1 };
  case "DECREMENT":
    return { ...state, count: state.count - 1 };
  case "RESET":
    return { ...state, count: 0 };
  default:
    return state;
}
```

### When to prefer map over switch:

- More than 4–5 cases
- Cases may grow in the future
- Logic per case is more than 2 lines → extract to strategy functions

---

## 9. Avoid Else After Return

If a branch ends with `return`, `throw`, or `continue`, there is no need for `else`. It adds indentation for no reason.

### ❌ Bad — unnecessary else

```typescript
function getDiscount(user: TUser): number {
  if (user.isPremium) {
    return 0.2;
  } else {
    return 0;
  }
}
```

### ✅ Good — no else needed

```typescript
function getDiscount(user: TUser): number {
  if (user.isPremium) return 0.2;
  return 0;
}
```

---

## 10. Throw Early for Invalid State

Don't keep conditions around for invalid states throughout the function. Throw or return an error at the top.

### ❌ Bad — carrying null check through the function

```typescript
function sendEmail(user: TUser | null): void {
  if (user) {
    if (user.email) {
      const message = buildMessage(user);
      if (message) {
        deliver(user.email, message);
      }
    }
  }
}
```

### ✅ Good — throw/return early

```typescript
function sendEmail(user: TUser | null): void {
  if (!user) throw new Error("User is required");
  if (!user.email) throw new Error("User email is missing");

  const message = buildMessage(user);
  if (!message) throw new Error("Message could not be built");

  deliver(user.email, message);
}
```

---

## 11. Boolean Expression Simplification

Avoid wrapping boolean expressions in `if` just to return `true`/`false`.

### ❌ Bad

```typescript
function isEligible(user: TUser): boolean {
  if (user.age >= 18 && user.isVerified) {
    return true;
  } else {
    return false;
  }
}
```

### ✅ Good

```typescript
const isEligible = (user: TUser): boolean => user.age >= 18 && user.isVerified;
```

---

## 12. Complex Conditions — Extract to Named Functions

If a condition requires multiple checks, name it. A function name is documentation.

### ❌ Bad — anonymous complex condition

```typescript
if (
  order.status === "pending" &&
  order.createdAt < Date.now() - 86400000 &&
  !order.isLocked &&
  user.role === "admin"
) {
  cancelOrder(order);
}
```

### ✅ Good — named predicate

```typescript
const isExpiredPendingOrder = (order: TOrder): boolean =>
  order.status === "pending" &&
  order.createdAt < Date.now() - 86400000 &&
  !order.isLocked;

const canAdminCancel = (user: TUser): boolean => user.role === "admin";

if (isExpiredPendingOrder(order) && canAdminCancel(user)) {
  cancelOrder(order);
}
```

---

## Summary Cheat Sheet

| Situation                         | Pattern                              |
| --------------------------------- | ------------------------------------ |
| Invalid input / missing data      | Early return / guard clause          |
| Assign one of two values          | Ternary `? :`                        |
| Assign one of N values by key     | Lookup map `Record<K, V>`            |
| Execute one of N behaviors by key | Strategy map `Record<K, () => void>` |
| Filter/transform a list           | `.filter()` / `.map()`               |
| Complex boolean check             | Extract to named predicate function  |
| Return after `if` branch          | Drop the `else`                      |
| Null / undefined fallback         | `??` and `?.` operators              |
| Branching on a string enum        | `switch` or lookup map               |
| Validate at function start        | Throw / return early                 |

---

## Golden Rules

1. **Never nest more than 2 levels deep.** If you reach level 3, refactor immediately.
2. **Name every non-trivial condition.** If you need to think to understand it, it needs a name.
3. **Return early, keep the happy path flat.**
4. **Prefer data over code.** A lookup map is more readable than 10 `else if` branches.
5. **One condition = one responsibility.** Split complex conditions into named predicates.
