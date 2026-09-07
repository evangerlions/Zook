/** Stable execution boundary; each call owns its database transaction/context. */
export type BodyLogExecution = <T>(operation: () => Promise<T>) => Promise<T>;

export function withBodyLogExecution<T extends object>(service: T, execute: BodyLogExecution): T {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => execute(() => value.apply(target, args));
    },
  });
}
