import { InMemoryCache } from "../infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../infrastructure/database/prisma/in-memory-database.ts";
import type { AppConfigRecord } from "../shared/types.ts";
import { randomId } from "../shared/utils.ts";

/**
 * AppConfigService mirrors the app_configs table plus the documented 30-second Redis cache layer.
 */
export class AppConfigService {
  private readonly cacheTtlSeconds = 30;

  constructor(
    private readonly database: InMemoryDatabase,
    private readonly cache: InMemoryCache,
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

  setValue(appId: string, configKey: string, configValue: string): void {
    const existing = this.database.appConfigs.find(
      (item) => item.appId === appId && item.configKey === configKey,
    );

    if (existing) {
      existing.configValue = configValue;
      existing.updatedAt = new Date().toISOString();
    } else {
      this.database.appConfigs.push({
        id: randomId("cfg"),
        appId,
        configKey,
        configValue,
        updatedAt: new Date().toISOString(),
      });
    }

    this.cache.delete(this.buildCacheKey(appId, configKey));
  }

  deleteByApp(appId: string): void {
    const keys = this.database.appConfigs
      .filter((item) => item.appId === appId)
      .map((item) => item.configKey);

    this.database.appConfigs = this.database.appConfigs.filter((item) => item.appId !== appId);
    keys.forEach((configKey) => {
      this.cache.delete(this.buildCacheKey(appId, configKey));
    });
  }

  getDefaultRoleCode(appId: string): string {
    return this.getValue(appId, "auth.default_role_code") ?? "member";
  }

  private buildCacheKey(appId: string, configKey: string): string {
    return `app-config:${appId}:${configKey}`;
  }
}
