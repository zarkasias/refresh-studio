/** Test-only: a shallow copy of `obj` without `key`. Not exported from the package. */
export function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}
