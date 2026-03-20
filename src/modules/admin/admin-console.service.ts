import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { AppConfigService } from "../../services/app-config.service.ts";
import { CommonEmailConfigService } from "../../services/common-email-config.service.ts";
import { ApplicationError, badRequest, conflict } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import type {
  AdminAppSummary,
  AdminBootstrapResult,
  AdminConfigDocument,
  AdminDeleteAppResult,
  AdminEmailServiceDocument,
  AppRecord,
  RoleRecord,
} from "../../shared/types.ts";

const ADMIN_CONFIG_KEY = "admin.delivery_config";
const EMPTY_CONFIG_TEMPLATE = {};
const COMMON_APP_ID = "common";
const COMMON_APP_RECORD: AppRecord = {
  id: COMMON_APP_ID,
  code: COMMON_APP_ID,
  name: "Common",
  status: "ACTIVE",
  joinMode: "AUTO",
  createdAt: "2026-03-20T00:00:00+08:00",
};

export class AdminConsoleService {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly appConfigService: AppConfigService,
    private readonly commonEmailConfigService: CommonEmailConfigService,
  ) {}

  getBootstrap(adminUser: string): AdminBootstrapResult {
    const commonSummary = this.toSummary(COMMON_APP_RECORD);
    const appSummaries = this.database.apps
      .map((app) => this.toSummary(app))
      .sort((left, right) => left.appName.localeCompare(right.appName, "zh-CN"));

    return {
      adminUser,
      apps: [commonSummary, ...appSummaries],
    };
  }

  getConfig(appId: string): AdminConfigDocument {
    const app = this.resolveManagedApp(appId);
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
    const app = this.resolveManagedApp(appId);
    const normalized = this.normalizeConfig(rawJson);

    this.appConfigService.setValue(app.id, ADMIN_CONFIG_KEY, normalized);

    return this.getConfig(app.id);
  }

  createApp(appId: string, appName?: string): AdminAppSummary {
    const normalizedId = appId.trim();
    if (!normalizedId) {
      badRequest("REQ_INVALID_BODY", "appId must be a non-empty string.");
    }

    if (normalizedId.toLowerCase() === COMMON_APP_ID) {
      conflict("ADMIN_APP_ID_RESERVED", "App ID common is reserved.");
    }

    if (this.database.findApp(normalizedId)) {
      conflict("ADMIN_APP_ALREADY_EXISTS", `App ${normalizedId} already exists.`);
    }

    const record: AppRecord = {
      id: normalizedId,
      code: normalizedId,
      name: (appName ?? normalizedId).trim() || normalizedId,
      status: "ACTIVE",
      joinMode: "AUTO",
      createdAt: new Date().toISOString(),
    };

    this.database.apps.push(record);
    this.createDefaultRoles(record.id);
    this.appConfigService.setValue(record.id, ADMIN_CONFIG_KEY, JSON.stringify(EMPTY_CONFIG_TEMPLATE, null, 2));

    return this.toSummary(record);
  }

  deleteApp(appId: string): AdminDeleteAppResult {
    if (appId === COMMON_APP_ID) {
      conflict("ADMIN_APP_ID_RESERVED", "App ID common is reserved.");
    }

    const app = this.requireApp(appId);

    if (!this.isDeleteAllowed(app.id)) {
      conflict(
        "ADMIN_APP_DELETE_REQUIRES_EMPTY_CONFIG",
        "Config must be an empty JSON object before deleting the app.",
      );
    }

    const roleIds = this.database.roles
      .filter((item) => item.appId === app.id)
      .map((item) => item.id);

    this.database.apps = this.database.apps.filter((item) => item.id !== app.id);
    this.database.appUsers = this.database.appUsers.filter((item) => item.appId !== app.id);
    this.database.roles = this.database.roles.filter((item) => item.appId !== app.id);
    this.database.userRoles = this.database.userRoles.filter((item) => item.appId !== app.id);
    this.database.rolePermissions = this.database.rolePermissions.filter(
      (item) => !roleIds.includes(item.roleId),
    );
    this.database.refreshTokens = this.database.refreshTokens.filter((item) => item.appId !== app.id);
    this.database.auditLogs = this.database.auditLogs.filter((item) => item.appId !== app.id);
    this.database.notificationJobs = this.database.notificationJobs.filter((item) => item.appId !== app.id);
    this.database.failedEvents = this.database.failedEvents.filter((item) => item.appId !== app.id);
    this.database.analyticsEvents = this.database.analyticsEvents.filter((item) => item.appId !== app.id);
    this.database.files = this.database.files.filter((item) => item.appId !== app.id);
    this.appConfigService.deleteByApp(app.id);

    return {
      deleted: true,
      appId: app.id,
    };
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
      return JSON.stringify(EMPTY_CONFIG_TEMPLATE, null, 2);
    }

    return this.normalizeConfig(stored);
  }

  private isDeleteAllowed(appId: string): boolean {
    if (appId === COMMON_APP_ID) {
      return false;
    }

    return this.readNormalizedConfig(appId) === JSON.stringify({}, null, 2);
  }

  getEmailServiceConfig(): AdminEmailServiceDocument {
    return this.commonEmailConfigService.getDocument();
  }

  updateEmailServiceConfig(input: unknown): AdminEmailServiceDocument {
    return this.commonEmailConfigService.updateConfig(input);
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
      canDelete: this.isDeleteAllowed(app.id),
    };
  }

  private resolveManagedApp(appId: string): AppRecord {
    if (appId === COMMON_APP_ID) {
      return COMMON_APP_RECORD;
    }

    return this.requireApp(appId);
  }

  private createDefaultRoles(appId: string): void {
    const memberRole: RoleRecord = {
      id: randomId(`role_${appId}_member`),
      appId,
      code: "member",
      name: "Member",
      status: "ACTIVE",
    };
    const adminRole: RoleRecord = {
      id: randomId(`role_${appId}_admin`),
      appId,
      code: "admin",
      name: "Admin",
      status: "ACTIVE",
    };

    this.database.roles.push(memberRole, adminRole);

    const permissionMap = new Map(this.database.permissions.map((item) => [item.code, item.id]));
    const memberPermissions = ["file:read"];
    const adminPermissions = ["file:read", "metrics:read", "notification:send"];

    memberPermissions.forEach((code) => {
      const permissionId = permissionMap.get(code);
      if (!permissionId) {
        return;
      }

      this.database.rolePermissions.push({
        id: randomId(`rp_${appId}_member`),
        roleId: memberRole.id,
        permissionId,
      });
    });

    adminPermissions.forEach((code) => {
      const permissionId = permissionMap.get(code);
      if (!permissionId) {
        return;
      }

      this.database.rolePermissions.push({
        id: randomId(`rp_${appId}_admin`),
        roleId: adminRole.id,
        permissionId,
      });
    });
  }
}
