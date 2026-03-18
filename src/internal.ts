export function createChainMethodDescriptor<TValue>(
  value: TValue,
): PropertyDescriptor {
  return {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  };
}

export function createNestedFieldDescriptor(fieldPath: string): {
  collectionKey: string;
  nestedKey: string;
} | null {
  const dotIndex = fieldPath.indexOf(".");
  if (dotIndex === -1) {
    return null;
  }

  return {
    collectionKey: fieldPath.substring(0, dotIndex),
    nestedKey: fieldPath.substring(dotIndex + 1),
  };
}
