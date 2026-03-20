import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { AppConfigService } from "../../services/app-config.service.ts";
import { ApplicationError, badRequest } from "../../shared/errors.ts";
import type { AdminAppSummary, AdminBootstrapResult, AdminConfigDocument, AppRecord } from "../../shared/types.ts";

const ADMIN_CONFIG_KEY = "admin.delivery_config";
const DEFAULT_CONFIG_TEMPLATE = {
  release: {
    version: "1.0.0",
    channel: "stable",
  },
  featureFlags: {},
  settings: {},
};

export class AdminConsoleService {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly appConfigService: AppConfigService,
  ) {}

  getBootstrap(adminUser: string): AdminBootstrapResult {
    return {
      adminUser,
      apps: this.database.apps
        .map((app) => this.toSummary(app))
        .sort((left, right) => left.appName.localeCompare(right.appName, "zh-CN")),
    };
  }

  getConfig(appId: string): AdminConfigDocument {
    const app = this.requireApp(appId);
    const rawJson = this.readNormalizedConfig(app.id);
    const record = this.database.appConfigs.find(
      (item) => item.appId === app.id && item.configKey === ADMIN_CONFIG_KEY,
    );

    return {
      app: this.toSummary(app),
      configKey: ADMIN_CONFIG_KEY,
      rawJson,
      updatedAt: record?.updatedAt,
    };
  }

  updateConfig(appId: string, rawJson: string): AdminConfigDocument {
    const app = this.requireApp(appId);
    const normalized = this.normalizeConfig(rawJson);

    this.appConfigService.setValue(app.id, ADMIN_CONFIG_KEY, normalized);

    return this.getConfig(app.id);
  }

  private requireApp(appId: string): AppRecord {
    const app = this.database.findApp(appId);
    if (!app) {
      throw new ApplicationError(404, "APP_NOT_FOUND", `App ${appId} was not found.`);
    }

    return app;
  }

  private readNormalizedConfig(appId: string): string {
    const stored = this.appConfigService.getValue(appId, ADMIN_CONFIG_KEY);
    if (!stored) {
      return JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2);
    }

    return this.normalizeConfig(stored);
  }

  private normalizeConfig(rawJson: string): string {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawJson);
    } catch {
      badRequest("ADMIN_CONFIG_INVALID_JSON", "Config must be valid JSON.");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      badRequest("ADMIN_CONFIG_INVALID_JSON", "Config root must be a JSON object.");
    }

    return JSON.stringify(parsed, null, 2);
  }

  private toSummary(app: AppRecord): AdminAppSummary {
    return {
      appId: app.id,
      appCode: app.code,
      appName: app.name,
      status: app.status,
    };
  }
}
