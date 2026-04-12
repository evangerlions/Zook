import { createClient, type RedisClientType } from "redis";

export interface KVBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  setIfNotExists(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  delete(key: string): Promise<void>;
  assertReady(): Promise<void>;
  disconnect?(): Promise<void>;
}

interface KVManagerOptions {
  backend?: KVBackend;
  redisUrl?: string;
}

class RedisKVBackend implements KVBackend {
  private readonly client: RedisClientType;
  private connectPromise?: Promise<void>;

  constructor(redisUrl: string) {
    this.client = createClient({
      url: redisUrl,
    });
  }

  async get(key: string): Promise<string | null> {
    await this.ensureConnected();
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.ensureConnected();
    if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
      await this.client.set(key, value, {
        EX: ttlSeconds,
      });
      return;
    }

    await this.client.set(key, value);
  }

  async setIfNotExists(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    await this.ensureConnected();
    const result = typeof ttlSeconds === "number" && ttlSeconds > 0
      ? await this.client.set(key, value, { NX: true, EX: ttlSeconds })
      : await this.client.set(key, value, { NX: true });
    return result === "OK";
  }

  async delete(key: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(key);
  }

  async assertReady(): Promise<void> {
    await this.ensureConnected();
    await this.client.ping();
  }

  async disconnect(): Promise<void> {
    if (!this.client.isOpen) {
      return;
    }

    await this.client.quit();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().finally(() => {
        this.connectPromise = undefined;
      });
    }

    await this.connectPromise;
  }
}

export class InMemoryKVBackend implements KVBackend {
  private readonly store = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: typeof ttlSeconds === "number" && ttlSeconds > 0
        ? Date.now() + ttlSeconds * 1000
        : undefined,
    });
  }

  async setIfNotExists(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && (!existing.expiresAt || existing.expiresAt > now)) {
      return false;
    }

    if (existing?.expiresAt && existing.expiresAt <= now) {
      this.store.delete(key);
    }

    this.store.set(key, {
      value,
      expiresAt: typeof ttlSeconds === "number" && ttlSeconds > 0
        ? now + ttlSeconds * 1000
        : undefined,
    });
    return true;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async assertReady(): Promise<void> {}
}

export class KVManager {
  private static sharedInstance?: KVManager;

  private constructor(private readonly backend: KVBackend) {}

  static async create(options: KVManagerOptions = {}): Promise<KVManager> {
    return new KVManager(resolveBackend(options));
  }

  static async getShared(options: KVManagerOptions = {}): Promise<KVManager> {
    if (!KVManager.sharedInstance) {
      KVManager.sharedInstance = new KVManager(resolveBackend(options));
    }

    return KVManager.sharedInstance;
  }

  static async resetShared(): Promise<void> {
    if (!KVManager.sharedInstance) {
      return;
    }

    await KVManager.sharedInstance.disconnect();
    KVManager.sharedInstance = undefined;
  }

  async assertReady(): Promise<void> {
    await this.backend.assertReady();
  }

  async getString(scope: string, key: string): Promise<string | undefined> {
    const value = await this.backend.get(this.buildStorageKey(scope, key));
    return value ?? undefined;
  }

  async setString(scope: string, key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.backend.set(this.buildStorageKey(scope, key), value, ttlSeconds);
  }

  async delete(scope: string, key: string): Promise<void> {
    await this.backend.delete(this.buildStorageKey(scope, key));
  }

  async getJson<T>(scope: string, key: string): Promise<T | undefined> {
    const raw = await this.getString(scope, key);
    if (!raw) {
      return undefined;
    }

    return JSON.parse(raw) as T;
  }

  async setJson(scope: string, key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.setString(scope, key, JSON.stringify(value), ttlSeconds);
  }

  async setIfNotExists(scope: string, key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    return this.backend.setIfNotExists(this.buildStorageKey(scope, key), value, ttlSeconds);
  }

  async disconnect(): Promise<void> {
    await this.backend.disconnect?.();
  }

  private buildStorageKey(scope: string, key: string): string {
    const normalizedScope = scope.trim();
    const normalizedKey = key.trim();

    if (!normalizedScope || !normalizedKey) {
      throw new Error("KVManager requires non-empty scope and key.");
    }

    return `kv:${encodeURIComponent(normalizedScope)}:${encodeURIComponent(normalizedKey)}`;
  }
}

function resolveBackend(options: KVManagerOptions): KVBackend {
  if (options.backend) {
    return options.backend;
  }

  const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
  if (!redisUrl?.trim()) {
    const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
    const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
    const allowInMemory = String(process.env.ALLOW_IN_MEMORY_KV ?? "").trim().toLowerCase() === "true";
    if (appEnv === "local" || appEnv === "test" || nodeEnv === "development" || nodeEnv === "test" || allowInMemory) {
      console.warn("[kv] REDIS_URL is empty, falling back to in-memory KV (not for production).");
      return new InMemoryKVBackend();
    }
    throw new Error("REDIS_URL is required for production runtime.");
  }

  return new RedisKVBackend(redisUrl.trim());
}
