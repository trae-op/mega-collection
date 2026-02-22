# TypeScript Best Practices Guide

## Core Principles

Generate professional, maintainable TypeScript code following modern standards and architectural patterns. Prioritize type safety, code clarity, and performance optimization.

## Type System Guidelines

### Type Definitions

Always use `type` instead of `interface` for all type definitions.

```
type TUser = {
  id: string;
  name: string;
  email: string;
};

type TApiResponse<T> = {
  data: T;
  status: number;
  message: string;
};
```

### Naming Conventions

```
Prefix all type names with `T`:
- `type TComponentProps = {}`
- `type TUserData = {}`
- `type TApiError = {}`
```

### Type Composition

Leverage utility types and composition:

```
type TBaseEntity = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

type TUser = TBaseEntity & {
  name: string;
  email: string;
};

type TPartialUser = Partial<TUser>;
type TRequiredUser = Required<TPartialUser>;
type TUserKeys = keyof TUser;
type TUserEmail = Pick<TUser, 'email'>;
type TUserWithoutEmail = Omit<TUser, 'email'>;
```

### Generic Types

Use descriptive generic parameter names:

```
type TApiHandler<TRequest, TResponse> = (
  request: TRequest
) => Promise<TResponse>;

type TStateUpdater<TState> = (prevState: TState) => TState;

type TValidator<TValue> = (value: TValue) => boolean;
```

## File Organization

### Separate Type Definitions

Store all types in dedicated `types.ts` files:

```architecture
src/
└── components/
    └── UserCard/
        ├── UserCard.tsx
        └── types.ts
```

### Export Strategy

Use Named Exports exclusively:

```
export type TUser = {
  id: string;
  name: string;
};

export const fetchUser = async (id: string): Promise<TUser> => {
  return await api.get(`/users/${id}`);
};

export const useUser = (id: string) => {
  return useQuery(['user', id], () => fetchUser(id));
};
```

## Function Definitions

### Arrow Functions

Use arrow functions with explicit return types:

```
export const calculateTotal = (items: TCartItem[]): number => {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
};

export const formatCurrency = (amount: number, currency: string): string => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
};
```

### Async Operations

Always type async functions with Promise return types:

```
export const fetchUserData = async (userId: string): Promise<TUser> => {
  const response = await fetch(`/api/users/${userId}`);
  return await response.json();
};

export const saveUser = async (user: TUser): Promise<void> => {
  await fetch(`/api/users/${user.id}`, {
    method: 'PUT',
    body: JSON.stringify(user),
  });
};
```

## React Component Patterns

### Component Structure

Components must be arrow functions with typed props in arguments:

```
export const UserCard = memo((props: TUserCardProps) => {
  const { user, onEdit, onDelete } = props;
  const { isEditing, handleEdit } = useUserCard(user);
  
  return (
    <div>
      <h2>{user.name}</h2>
      <p>{user.email}</p>
      {isEditing && <button onClick={handleEdit}>Save</button>}
    </div>
  );
});
```

### Props Typing

Define props types clearly without React.FC or FC:

```
type TButtonProps = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
};

export const Button = memo((props: TButtonProps) => {
  const { label, onClick, variant = 'primary', disabled = false } = props;
  
  return (
    <button onClick={onClick} disabled={disabled} className={variant}>
      {label}
    </button>
  );
});
```

### Custom Hooks

Move all component logic to custom hooks:

```
type TUseUserCardReturn = {
  isEditing: boolean;
  isLoading: boolean;
  error: Error | null;
  handleEdit: () => void;
  handleSave: () => Promise<void>;
  handleCancel: () => void;
};

export const useUserCard = (user: TUser): TUseUserCardReturn => {
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleSave = useCallback(async () => {
    setIsLoading(true);
    try {
      await saveUser(user);
      setIsEditing(false);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  return {
    isEditing,
    isLoading,
    error,
    handleEdit,
    handleSave,
    handleCancel,
  };
};
```

## Advanced Type Patterns

### Discriminated Unions

Use for state management and API responses:

```
type TLoadingState = {
  status: 'loading';
};

type TSuccessState<T> = {
  status: 'success';
  data: T;
};

type TErrorState = {
  status: 'error';
  error: Error;
};

type TAsyncState<T> = TLoadingState | TSuccessState<T> | TErrorState;

export const handleAsyncState = <T>(state: TAsyncState<T>): string => {
  switch (state.status) {
    case 'loading':
      return 'Loading...';
    case 'success':
      return `Data: ${JSON.stringify(state.data)}`;
    case 'error':
      return `Error: ${state.error.message}`;
  }
};
```

### Type Guards

Create reusable type guards:

```
export const isError = (value: unknown): value is Error => {
  return value instanceof Error;
};

export const isString = (value: unknown): value is string => {
  return typeof value === 'string';
};

export const isArrayOf = <T>(
  value: unknown,
  guard: (item: unknown) => item is T
): value is T[] => {
  return Array.isArray(value) && value.every(guard);
};
```

### Mapped Types

Transform types dynamically:

```
type TReadonly<T> = {
  readonly [K in keyof T]: T[K];
};

type TNullable<T> = {
  [K in keyof T]: T[K] | null;
};

type TDeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? TDeepPartial<T[K]> : T[K];
};
```

## Error Handling

### Typed Errors

Create custom error types:

```
type TValidationError = {
  type: 'validation';
  field: string;
  message: string;
};

type TNetworkError = {
  type: 'network';
  statusCode: number;
  message: string;
};

type TApiError = TValidationError | TNetworkError;

export const handleApiError = (error: TApiError): string => {
  switch (error.type) {
    case 'validation':
      return `Validation failed for ${error.field}: ${error.message}`;
    case 'network':
      return `Network error (${error.statusCode}): ${error.message}`;
  }
};
```

### Safe Parsing

Type-safe data parsing:

```
export const parseUser = (data: unknown): TUser | null => {
  if (
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    'name' in data &&
    'email' in data &&
    typeof data.id === 'string' &&
    typeof data.name === 'string' &&
    typeof data.email === 'string'
  ) {
    return data as TUser;
  }
  return null;
};
```

## Performance Optimization

### Type-Safe Memoization

```
export const useMemoizedValue = <T>(factory: () => T, deps: unknown[]): T => {
  return useMemo(factory, deps);
};

export const useMemoizedCallback = <T extends (...args: unknown[]) => unknown>(
  callback: T,
  deps: unknown[]
): T => {
  return useCallback(callback, deps) as T;
};
```

### Lazy Loading

```
type TLazyComponent<T> = React.LazyExoticComponent<React.ComponentType<T>>;

export const createLazyComponent = <T>(
  factory: () => Promise<{ default: React.ComponentType<T> }>
): TLazyComponent<T> => {
  return lazy(factory);
};
```

## Algorithmic Approach

### Data Structures

Use appropriate TypeScript data structures:

```
type THashMap<K extends string | number, V> = Record<K, V>;

export const createHashMap = <K extends string | number, V>(
  items: V[],
  keyExtractor: (item: V) => K
): THashMap<K, V> => {
  return items.reduce((acc, item) => {
    acc[keyExtractor(item)] = item;
    return acc;
  }, {} as THashMap<K, V>);
};

export const groupBy = <T, K extends string | number>(
  items: T[],
  keyExtractor: (item: T) => K
): THashMap<K, T[]> => {
  return items.reduce((acc, item) => {
    const key = keyExtractor(item);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {} as THashMap<K, T[]>);
};
```

### Type-Safe Algorithms

```
export const binarySearch = <T>(
  arr: T[],
  target: T,
  comparator: (a: T, b: T) => number
): number => {
  let left = 0;
  let right = arr.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const comparison = comparator(arr[mid], target);

    if (comparison === 0) return mid;
    if (comparison < 0) left = mid + 1;
    else right = mid - 1;
  }

  return -1;
};

export const quickSort = <T>(
  arr: T[],
  comparator: (a: T, b: T) => number
): T[] => {
  if (arr.length <= 1) return arr;

  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter(x => comparator(x, pivot) < 0);
  const middle = arr.filter(x => comparator(x, pivot) === 0);
  const right = arr.filter(x => comparator(x, pivot) > 0);

  return [...quickSort(left, comparator), ...middle, ...quickSort(right, comparator)];
};
```

## API Integration

### Type-Safe API Clients

```
type TApiConfig = {
  baseUrl: string;
  headers: Record<string, string>;
};

type TApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export const createApiClient = (config: TApiConfig) => {
  const request = async <TResponse>(
    method: TApiMethod,
    endpoint: string,
    body?: unknown
  ): Promise<TResponse> => {
    const response = await fetch(`${config.baseUrl}${endpoint}`, {
      method,
      headers: config.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return await response.json();
  };

  return {
    get: <TResponse>(endpoint: string) => request<TResponse>('GET', endpoint),
    post: <TRequest, TResponse>(endpoint: string, body: TRequest) =>
      request<TResponse>('POST', endpoint, body),
    put: <TRequest, TResponse>(endpoint: string, body: TRequest) =>
      request<TResponse>('PUT', endpoint, body),
    delete: <TResponse>(endpoint: string) => request<TResponse>('DELETE', endpoint),
  };
};
```

## Strict Compiler Configuration

Ensure `tsconfig.json` uses strict settings:

```
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

## Summary

Generate TypeScript code that is type-safe, performant, and maintainable. Prioritize explicit typing, separation of concerns, and algorithmic efficiency. Follow these patterns consistently across all generated code.