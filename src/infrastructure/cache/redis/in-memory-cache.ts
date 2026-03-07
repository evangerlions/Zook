/**
 * InMemoryCache mimics Redis-style TTL caching for runtime app configuration.
 */
export class InMemoryCache {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  get<T>(key: string, now = new Date()): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= now.getTime()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  set(key: string, value: unknown, ttlSeconds: number, now = new Date()): void {
    this.store.set(key, {
      value,
      expiresAt: now.getTime() + ttlSeconds * 1000,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
