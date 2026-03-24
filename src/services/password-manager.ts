import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { PasswordEntry } from "../shared/types.ts";

interface StoredPasswordMeta {
  key: string;
  desc: string;
  updatedAt: string;
}

const PASSWORD_INDEX_KEY = "__index__";

export class PasswordManager {
  constructor(private readonly kvManager: KVManager) {}

  async list(scope: string): Promise<PasswordEntry[]> {
    const index = await this.loadIndex(scope);
    const items = await Promise.all(
      index.map(async (item) => {
        const value = await this.kvManager.getString(scope, this.valueKey(item.key));
        return {
          key: item.key,
          desc: item.desc,
          value: value ?? "",
          updatedAt: item.updatedAt,
        } satisfies PasswordEntry;
      }),
    );

    return items.filter((item) => item.value !== "");
  }

  async get(scope: string, key: string): Promise<PasswordEntry | undefined> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return undefined;
    }

    const index = await this.loadIndex(scope);
    const meta = index.find((item) => item.key === normalizedKey);
    if (!meta) {
      return undefined;
    }

    const value = await this.kvManager.getString(scope, this.valueKey(normalizedKey));
    if (value === undefined) {
      return undefined;
    }

    return {
      key: meta.key,
      desc: meta.desc,
      value,
      updatedAt: meta.updatedAt,
    };
  }

  async getValue(scope: string, key: string): Promise<string | undefined> {
    return this.kvManager.getString(scope, this.valueKey(key.trim()));
  }

  async set(scope: string, key: string, desc: string, value: string, updatedAt = new Date().toISOString()): Promise<void> {
    const normalizedKey = key.trim();
    const index = await this.loadIndex(scope);
    const nextMeta: StoredPasswordMeta = {
      key: normalizedKey,
      desc: desc.trim(),
      updatedAt,
    };

    const nextIndex = index.some((item) => item.key === normalizedKey)
      ? index.map((item) => (item.key === normalizedKey ? nextMeta : item))
      : [...index, nextMeta];

    await this.kvManager.setString(scope, this.valueKey(normalizedKey), value);
    await this.saveIndex(scope, nextIndex);
  }

  async replace(scope: string, items: PasswordEntry[]): Promise<void> {
    const nextIndex: StoredPasswordMeta[] = [];
    const nextKeys = new Set<string>();

    for (const item of items) {
      const updatedAt = item.updatedAt ?? new Date().toISOString();
      await this.set(scope, item.key, item.desc, item.value, updatedAt);
      nextIndex.push({
        key: item.key.trim(),
        desc: item.desc.trim(),
        updatedAt,
      });
      nextKeys.add(item.key.trim());
    }

    const currentIndex = await this.loadIndex(scope);
    const removedKeys = currentIndex
      .map((item) => item.key)
      .filter((key) => !nextKeys.has(key));

    await Promise.all(removedKeys.map((key) => this.kvManager.delete(scope, this.valueKey(key))));
    await this.saveIndex(scope, nextIndex);
  }

  async delete(scope: string, key: string): Promise<void> {
    const normalizedKey = key.trim();
    const currentIndex = await this.loadIndex(scope);
    const nextIndex = currentIndex.filter((item) => item.key !== normalizedKey);
    await this.kvManager.delete(scope, this.valueKey(normalizedKey));
    await this.saveIndex(scope, nextIndex);
  }

  private async loadIndex(scope: string): Promise<StoredPasswordMeta[]> {
    const index = await this.kvManager.getJson<StoredPasswordMeta[]>(scope, PASSWORD_INDEX_KEY);
    if (!Array.isArray(index)) {
      return [];
    }

    return index.filter((item) => item && typeof item.key === "string");
  }

  private async saveIndex(scope: string, index: StoredPasswordMeta[]): Promise<void> {
    await this.kvManager.setJson(scope, PASSWORD_INDEX_KEY, index);
  }

  private valueKey(key: string): string {
    return `value:${key}`;
  }
}
