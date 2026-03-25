import type { ConfigRevisionMeta, ConfigRevisionRecord } from "../../shared/types.ts";
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
    const index = (await this.getIndex()) ?? this.createEmptyIndex();
    const revision = index.latestRevision + 1;
    const record: ConfigRevisionRecord<T> = {
      revision,
      content: this.serialize(content),
      desc: desc.trim(),
      createdAt: new Date().toISOString(),
    };

    await this.kvManager.setJson(this.scope, this.buildRevisionKey(revision), record);
    await this.kvManager.setJson(this.scope, INDEX_KEY, {
      version: 1,
      latestRevision: revision,
      versions: [
        ...index.versions,
        {
          revision: record.revision,
          desc: record.desc,
          createdAt: record.createdAt,
        },
      ],
    } satisfies ConfigRevisionIndexPayload);

    return record;
  }

  async restore(revision: number, desc?: string): Promise<ConfigRevisionRecord<T>> {
    const target = await this.getVersion(revision);
    if (!target) {
      throw new Error(`Config revision ${revision} was not found.`);
    }

    return this.update(target.content, desc ?? `${this.descKey}:${revision}`);
  }

  async ensureInitial(content: T, desc = "", createdAt?: string): Promise<ConfigRevisionRecord<T>> {
    const latest = await this.getLatest();
    if (latest) {
      return latest;
    }

    const record: ConfigRevisionRecord<T> = {
      revision: 1,
      content: this.serialize(content),
      desc: desc.trim(),
      createdAt: createdAt ?? new Date().toISOString(),
    };

    await this.kvManager.setJson(this.scope, this.buildRevisionKey(1), record);
    await this.kvManager.setJson(this.scope, INDEX_KEY, {
      version: 1,
      latestRevision: 1,
      versions: [
        {
          revision: record.revision,
          desc: record.desc,
          createdAt: record.createdAt,
        },
      ],
    } satisfies ConfigRevisionIndexPayload);

    return record;
  }

  async clear(): Promise<void> {
    const versions = await this.listVersions();
    await Promise.all(
      [
        this.kvManager.delete(this.scope, INDEX_KEY),
        ...versions.map((item) => this.kvManager.delete(this.scope, this.buildRevisionKey(item.revision))),
      ],
    );
  }

  private async getIndex(): Promise<ConfigRevisionIndexPayload | undefined> {
    const index = await this.kvManager.getJson<ConfigRevisionIndexPayload>(this.scope, INDEX_KEY);
    if (!index) {
      return undefined;
    }

    if (index.version !== 1 || !Array.isArray(index.versions)) {
      return undefined;
    }

    return index;
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
