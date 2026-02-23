# JavaScript Variables

## 1. Variable Declaration

### Use only `const` and `let`. Never use `var`.

```js
// ❌ Bad
var name = "John";

// ✅ Good
const name = "John";
let count = 0;
```

### Rule for choosing between `const` and `let`

- **`const`** — default for **everything**. Use when the variable is not reassigned.
- **`let`** — only when the variable **will be reassigned** (counters, state, loops).

```js
// ✅ const — not reassigned (even objects and arrays)
const user = { name: "Anna", age: 25 };
const items = [1, 2, 3];

// ✅ let — reassigned
let index = 0;
index = index + 1;
```

> **Important:** `const` for objects and arrays does not make them immutable — it only prevents reassignment of the variable itself. Mutation of properties is still possible.

---

## 2. Naming Variables

### General Rules

- The name must **clearly describe the content** of the variable.
- Use **camelCase** for variables and functions.
- Use **PascalCase** for classes and React components.
- Use **UPPER_SNAKE_CASE** for global constants and configurations.
- Use **\_camelCase** with a leading underscore for private/internal values (where needed).

```js
// ✅ camelCase
const userName = "Ivan";
const isLoggedIn = true;
let totalPrice = 0;

// ✅ PascalCase
class UserService {}
const UserCard = () => {};

// ✅ UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
const API_BASE_URL = "https://api.example.com";
```

### Boolean Variables

Boolean variable names must start with a verb: `is`, `has`, `can`, `should`, `was`, `did`.

```js
// ❌ Bad
const active = true;
const login = false;

// ✅ Good
const isActive = true;
const isLoggedIn = false;
const hasPermission = true;
const canEdit = false;
const shouldRedirect = true;
```

### Arrays

Array names must be in the **plural form**.

```js
// ❌ Bad
const user = ["Anna", "Ivan"];
const item = [1, 2, 3];

// ✅ Good
const users = ["Anna", "Ivan"];
const items = [1, 2, 3];
const selectedIds = [10, 20, 30];
```

### Functions and Callback Variables

Function variable names must start with a verb.

```js
// ❌ Bad
const data = () => fetchData();
const name = (user) => user.name;

// ✅ Good
const fetchUsers = () => {};
const getUserName = (user) => user.name;
const handleClick = () => {};
const formatDate = (date) => {};
```

### Avoid Non-Informative Names

```js
// ❌ Bad
const d = new Date();
const x = getUserData();
const temp = calculate();
const data2 = [];

// ✅ Good
const createdAt = new Date();
const userData = getUserData();
const discountAmount = calculate();
const filteredUsers = [];
```

---

## 3. Variable Initialization

### Always initialize a variable at declaration

```js
// ❌ Bad
let result;
let users;

// ✅ Good
let result = null;
let users = [];
```

### Use default values

```js
// ✅ Destructuring with default
const { name = "Anonymous", age = 0 } = user;

// ✅ Function parameters
const greet = (name = "Guest") => `Hello, ${name}`;
```

---

## 4. Scope

### Declare variables as close as possible to where they are used

```js
// ❌ Bad — variable is far from usage
const label = "Total";
// ... lots of code
console.log(label);

// ✅ Good — declared right before usage
// ... other code
const label = "Total";
console.log(label);
```

### Avoid polluting the global scope

```js
// ❌ Bad
count = 0; // no declaration — becomes global

// ✅ Good
const count = 0;
```

### Use block scope intentionally

```js
// ✅ Block scope for isolation
{
  const tempResult = heavyCalculation();
  processResult(tempResult);
}
// tempResult is not accessible here
```

---

## 5. Destructuring

### Use destructuring instead of chained property access

```js
// ❌ Bad
const firstName = user.profile.firstName;
const lastName = user.profile.lastName;
const city = user.address.city;

// ✅ Good
const {
  profile: { firstName, lastName },
  address: { city },
} = user;
```

### Array Destructuring

```js
// ✅ Arrays
const [first, second, ...rest] = items;
const [head, , third] = values; // skipping elements
```

### Renaming During Destructuring

```js
// ✅ When there is a name conflict
const { name: userName, id: userId } = user;
```

---

## 6. Naming in Loops and Iterations

```js
// ❌ Bad
items.forEach((i) => console.log(i));

// ✅ Good — name reflects the entity
items.forEach((item) => console.log(item));
users.forEach((user) => sendEmail(user));
orders.map((order) => formatOrder(order));
```

---

## 7. Temporary and Intermediate Variables

Extract complex expressions into named variables for readability.

```js
// ❌ Bad — hard to read
const result = users
  .filter((u) => u.age > 18 && u.isActive)
  .map((u) => ({ ...u, label: `${u.firstName} ${u.lastName}` }));

// ✅ Good — broken into steps with descriptive names
const adultActiveUsers = users.filter((user) => user.age > 18 && user.isActive);
const formattedUsers = adultActiveUsers.map((user) => ({
  ...user,
  label: `${user.firstName} ${user.lastName}`,
}));
```

---

## 8. Magic Numbers and Strings

Never use "magic" values directly — extract them into named constants.

```js
// ❌ Bad
if (status === 2) {
}
setTimeout(fn, 86400000);
const discount = price * 0.15;

// ✅ Good
const STATUS_APPROVED = 2;
const ONE_DAY_MS = 86_400_000;
const DISCOUNT_RATE = 0.15;

if (status === STATUS_APPROVED) {
}
setTimeout(fn, ONE_DAY_MS);
const discount = price * DISCOUNT_RATE;
```

> **Tip:** Use `_` as a separator in large numbers for readability: `1_000_000`.

---

## 9. Null and Undefined

```js
// ✅ Explicit initialization for absent values
const selectedUser = null; // intentionally empty
const cachedValue = undefined; // not yet initialized (rarely used)

// ✅ Optional chaining for safe access
const city = user?.address?.city;

// ✅ Nullish coalescing for default values
const displayName = user.name ?? "Anonymous";
```

---

## 10. Forbidden Practices

| Practice                                     | Why It Is Forbidden                                    |
| -------------------------------------------- | ------------------------------------------------------ |
| `var`                                        | Function-scoped, hoisting issues, block scope problems |
| Single-letter names (`x`, `i` outside loops) | Unreadable, not descriptive                            |
| Reassigning `const`                          | Runtime error                                          |
| Global variables without declaration         | Global scope pollution                                 |
| Similar names (`data`, `data2`, `newData`)   | Confusion, hard to maintain                            |
| Abbreviations (`usrNm`, `prdt`)              | Poor readability                                       |

---

## 11. Quick Reference for AI Agents

```
Question                                  → Solution
──────────────────────────────────────────────────────────────
Value does not change?                    → const
Value changes?                            → let
Global configuration needed?              → UPPER_SNAKE_CASE + const
Is it a boolean variable?                 → Start with is/has/can/should
Is it an array?                           → Use plural form
Is it a function stored in a variable?    → Start with a verb (get/fetch/handle)
Is there a magic number or string?        → Extract to a named constant
Is the expression too long?               → Break into intermediate named variables
```

---

## 12. Full Example — Before and After

```js
// ❌ Bad
var d = new Date();
var x = 86400000;
var u = getUser();
var b = u.age > 18;
var r = u.firstName + " " + u.lastName;

// ✅ Good
const createdAt = new Date();
const ONE_DAY_MS = 86_400_000;
const currentUser = getUser();
const isAdult = currentUser.age > 18;
const { firstName, lastName } = currentUser;
const fullName = `${firstName} ${lastName}`;
```
