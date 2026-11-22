import type { ConfigRevisionMeta, ConfigRevisionRecord } from "../../shared/types.ts";
import type { KVAtomicChange } from "./kv-atomic.ts";
import { KVManager } from "./kv-manager.ts";

interface ConfigRevisionIndexPayload {
  version: 1;
  latestRevision: number;
  versions: ConfigRevisionMeta[];
}

interface ConfigRevisionManagerOptions<T> {
  scope: string;
  contentKey?: string;
  descKey?: string;
  serialize?: (value: T) => T;
}

const INDEX_KEY = "index";

export class ConfigRevisionManager<T = string> {
  private readonly scope: string;
  private readonly contentKey: string;
  private readonly descKey: string;
  private readonly serialize: (value: T) => T;

  constructor(
    private readonly kvManager: KVManager,
    options: ConfigRevisionManagerOptions<T>,
  ) {
    this.scope = options.scope.trim();
    this.contentKey = options.contentKey?.trim() || "revision";
    this.descKey = options.descKey?.trim() || "restore";
    this.serialize = options.serialize ?? ((value) => value);

    if (!this.scope) {
      throw new Error("ConfigRevisionManager requires a non-empty scope.");
    }
  }

  async getLatest(): Promise<ConfigRevisionRecord<T> | undefined> {
    const index = await this.getIndex();
    if (!index?.latestRevision) {
      return undefined;
    }

    return this.getVersion(index.latestRevision);
  }

  async getVersion(revision: number): Promise<ConfigRevisionRecord<T> | undefined> {
    if (!Number.isInteger(revision) || revision <= 0) {
      return undefined;
    }

    return this.kvManager.getJson<ConfigRevisionRecord<T>>(this.scope, this.buildRevisionKey(revision));
  }

  async listVersions(): Promise<ConfigRevisionMeta[]> {
    const index = await this.getIndex();
    return index?.versions ? [...index.versions] : [];
  }

  async getVersionCount(): Promise<number> {
    return (await this.listVersions()).length;
  }

  async update(content: T, desc = ""): Promise<ConfigRevisionRecord<T>> {
    const input = this.serialize(content);
    return this.changeIndex(async index => this.appendRevision(index, input, desc));
  }

  async restore(revision: number, desc?: string): Promise<ConfigRevisionRecord<T>> {
    const target = await this.getVersion(revision);
    if (!target) {
      throw new Error(`Config revision ${revision} was not found.`);
    }

    return this.update(target.content, desc ?? `${this.descKey}:${revision}`);
  }

  async ensureInitial(content: T, desc = "", createdAt?: string): Promise<ConfigRevisionRecord<T>> {
    return this.changeIndex(async index => {
      const latest = await this.getVersion(index.latestRevision);
      if (latest) return { result: latest };
      return this.appendRevision(index, this.serialize(content), desc, createdAt);
    });
  }

  async clear(): Promise<void> {
    await this.changeIndex(async index => ({
      result: undefined,
      change: { set: [], delete: [INDEX_KEY, ...index.versions.map(item => this.buildRevisionKey(item.revision))] },
    }));
  }

  private async changeIndex<TResult>(prepare: (index: ConfigRevisionIndexPayload) => Promise<{
    result: TResult;
    change?: Omit<KVAtomicChange, "compare">;
  }>): Promise<TResult> {
    for (let attempt = 0; attempt < 32; attempt++) {
      const raw = await this.kvManager.getString(this.scope, INDEX_KEY);
      const { result, change } = await prepare(this.parseIndex(raw) ?? this.createEmptyIndex());
      if (!change || await this.kvManager.applyAtomic(this.scope, {
        ...change, compare: [{ key: INDEX_KEY, value: raw ?? null }],
      })) return result;
    }
    throw Error("Config revision changed repeatedly while saving. Please retry.");
  }

  private appendRevision(index: ConfigRevisionIndexPayload, content: T, desc: string, createdAt = new Date().toISOString()) {
    const revision = index.latestRevision + 1;
    const record: ConfigRevisionRecord<T> = { revision, content, desc: desc.trim(), createdAt };
    const nextIndex: ConfigRevisionIndexPayload = {
      version: 1, latestRevision: revision, versions: [...index.versions, { revision, desc: record.desc, createdAt }],
    };
    return { result: record, change: { set: [
      { key: this.buildRevisionKey(revision), value: JSON.stringify(record) },
      { key: INDEX_KEY, value: JSON.stringify(nextIndex) },
    ] } };
  }

  private async getIndex(): Promise<ConfigRevisionIndexPayload | undefined> {
    return this.parseIndex(await this.kvManager.getString(this.scope, INDEX_KEY));
  }

  private parseIndex(raw: string | undefined): ConfigRevisionIndexPayload | undefined {
    const index = raw ? JSON.parse(raw) as ConfigRevisionIndexPayload : undefined;
    return index?.version === 1 && Array.isArray(index.versions) ? index : undefined;
  }

  private createEmptyIndex(): ConfigRevisionIndexPayload {
    return {
      version: 1,
      latestRevision: 0,
      versions: [],
    };
  }

  private buildRevisionKey(revision: number): string {
    return `${this.contentKey}:${revision}`;
  }
}
