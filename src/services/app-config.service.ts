import { InMemoryCache } from "../infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../infrastructure/database/prisma/in-memory-database.ts";
import { ConfigRevisionManager } from "../infrastructure/kv/config-revision-manager.ts";
import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { AppConfigRecord, ConfigRevisionMeta, ConfigRevisionRecord } from "../shared/types.ts";
import { randomId } from "../shared/utils.ts";

/**
 * AppConfigService mirrors the app_configs table plus the documented 30-second Redis cache layer.
 */
export class AppConfigService {
  private readonly cacheTtlSeconds = 30;

  constructor(
    private readonly database: InMemoryDatabase,
    private readonly cache: InMemoryCache,
    private readonly kvManager: KVManager,
  ) {}

  getValue(appId: string, configKey: string, now = new Date()): string | undefined {
    const cacheKey = this.buildCacheKey(appId, configKey);
    const cached = this.cache.get<string>(cacheKey, now);
    if (cached !== undefined) {
      return cached;
    }

    const record = this.database.appConfigs.find(
      (item) => item.appId === appId && item.configKey === configKey,
    );

    if (!record) {
      return undefined;
    }

    this.cache.set(cacheKey, record.configValue, this.cacheTtlSeconds, now);
    return record.configValue;
  }

  getRecord(appId: string, configKey: string): AppConfigRecord | undefined {
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
    const existing = this.getRecord(appId, configKey);

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

  getDefaultRoleCode(appId: string): string {
    return this.getValue(appId, "auth.default_role_code") ?? "member";
  }

  setDirectValue(
    appId: string,
    configKey: string,
    configValue: string,
    updatedAt = new Date().toISOString(),
  ): void {
    this.upsertRecord(appId, configKey, configValue, updatedAt);
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
    const existing = this.getRecord(appId, configKey);
    if (!existing) {
      return;
    }

    await this.getRevisionManager(appId, configKey).ensureInitial(
      existing.configValue,
      "initial",
      existing.updatedAt,
    );
  }

  private upsertRecord(appId: string, configKey: string, configValue: string, updatedAt: string): void {
    const existing = this.database.appConfigs.find(
      (item) => item.appId === appId && item.configKey === configKey,
    );

    if (existing) {
      existing.configValue = configValue;
      existing.updatedAt = updatedAt;
    } else {
      this.database.appConfigs.push({
        id: randomId("cfg"),
        appId,
        configKey,
        configValue,
        updatedAt,
      });
    }

    this.cache.delete(this.buildCacheKey(appId, configKey));
  }
}
