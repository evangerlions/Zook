import { InMemoryCache } from "../infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../infrastructure/database/prisma/in-memory-database.ts";
import { ConfigRevisionManager } from "../infrastructure/kv/config-revision-manager.ts";
import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { AppConfigRecord, ConfigRevisionMeta, ConfigRevisionRecord } from "../shared/types.ts";
import { randomId } from "../shared/utils.ts";

/**
 * VersionedAppConfigService owns app configuration that requires revision history.
 * Revisions are the canonical source of truth and app_configs is only a derived
 * current-value cache.
 *
 * Config that does not need revision history, such as secrets or other single-value
 * runtime state, should talk to KVManager directly instead of using this service.
 */
export class VersionedAppConfigService {
  private readonly cacheTtlSeconds = 30;

  constructor(
    private readonly database: InMemoryDatabase,
    private readonly cache: InMemoryCache,
    private readonly kvManager: KVManager,
  ) {}

  async getValue(appId: string, configKey: string): Promise<string | undefined> {
    const record = await this.getRecord(appId, configKey);
    return record?.configValue;
  }

  async getRecord(appId: string, configKey: string): Promise<AppConfigRecord | undefined> {
    const latestRevision = await this.getLatestRevision(appId, configKey);
    if (!latestRevision) {
      return this.readCachedRecord(appId, configKey);
    }

    const directRecord = this.readCachedRecord(appId, configKey);
    if (
      directRecord &&
      directRecord.configValue === latestRevision.content &&
      directRecord.updatedAt === latestRevision.createdAt
    ) {
      return directRecord;
    }

    return this.upsertRecord(appId, configKey, latestRevision.content, latestRevision.createdAt);
  }

  async getUpdatedAt(appId: string, configKey: string): Promise<string | undefined> {
    return (await this.getRecord(appId, configKey))?.updatedAt;
  }

  private readCachedRecord(appId: string, configKey: string): AppConfigRecord | undefined {
    return this.database.appConfigs.find(
      (item) => item.appId === appId && item.configKey === configKey,
    );
  }

  async setValue(
    appId: string,
    configKey: string,
    configValue: string,
    desc = "",
  ): Promise<ConfigRevisionRecord<string>> {
    const revisionManager = this.getRevisionManager(appId, configKey);
    const existing = this.readCachedRecord(appId, configKey);

    if (existing) {
      await revisionManager.ensureInitial(
        existing.configValue,
        "initial",
        existing.updatedAt,
      );
    }

    const revision = await revisionManager.update(configValue, desc);
    this.upsertRecord(appId, configKey, configValue, revision.createdAt);
    return revision;
  }

  async restoreValue(
    appId: string,
    configKey: string,
    revision: number,
    desc?: string,
  ): Promise<ConfigRevisionRecord<string>> {
    const revisionManager = this.getRevisionManager(appId, configKey);
    const restored = await revisionManager.restore(revision, desc);
    this.upsertRecord(appId, configKey, restored.content, restored.createdAt);
    return restored;
  }

  async getLatestRevision(
    appId: string,
    configKey: string,
  ): Promise<ConfigRevisionRecord<string> | undefined> {
    await this.ensureInitialRevision(appId, configKey);
    return this.getRevisionManager(appId, configKey).getLatest();
  }

  async getRevision(
    appId: string,
    configKey: string,
    revision: number,
  ): Promise<ConfigRevisionRecord<string> | undefined> {
    await this.ensureInitialRevision(appId, configKey);
    return this.getRevisionManager(appId, configKey).getVersion(revision);
  }

  async listRevisions(appId: string, configKey: string): Promise<ConfigRevisionMeta[]> {
    await this.ensureInitialRevision(appId, configKey);
    return this.getRevisionManager(appId, configKey).listVersions();
  }

  async getRevisionCount(appId: string, configKey: string): Promise<number> {
    await this.ensureInitialRevision(appId, configKey);
    return this.getRevisionManager(appId, configKey).getVersionCount();
  }

  async deleteByApp(appId: string): Promise<void> {
    const keys = this.database.appConfigs
      .filter((item) => item.appId === appId)
      .map((item) => item.configKey);

    this.database.appConfigs = this.database.appConfigs.filter((item) => item.appId !== appId);
    await Promise.all(keys.map((configKey) => this.getRevisionManager(appId, configKey).clear()));
    keys.forEach((configKey) => {
      this.cache.delete(this.buildCacheKey(appId, configKey));
    });
  }

  async getDefaultRoleCode(appId: string): Promise<string> {
    return (await this.getValue(appId, "auth.default_role_code")) ?? "member";
  }

  private buildCacheKey(appId: string, configKey: string): string {
    return `app-config:${appId}:${configKey}`;
  }

  private getRevisionManager(appId: string, configKey: string): ConfigRevisionManager<string> {
    return new ConfigRevisionManager<string>(this.kvManager, {
      scope: `app-config-revision:${appId}:${configKey}`,
    });
  }

  private async ensureInitialRevision(appId: string, configKey: string): Promise<void> {
    const existing = this.readCachedRecord(appId, configKey);
    if (!existing) {
      return;
    }

    await this.getRevisionManager(appId, configKey).ensureInitial(
      existing.configValue,
      "initial",
      existing.updatedAt,
    );
  }

  private upsertRecord(appId: string, configKey: string, configValue: string, updatedAt: string): AppConfigRecord {
    const existing = this.database.appConfigs.find(
      (item) => item.appId === appId && item.configKey === configKey,
    );

    if (existing) {
      existing.configValue = configValue;
      existing.updatedAt = updatedAt;
      this.cache.delete(this.buildCacheKey(appId, configKey));
      return existing;
    } else {
      const created = {
        id: randomId("cfg"),
        appId,
        configKey,
        configValue,
        updatedAt,
      };
      this.database.appConfigs.push(created);
      this.cache.delete(this.buildCacheKey(appId, configKey));
      return created;
    }
  }
}
