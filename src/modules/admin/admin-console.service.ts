import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { ManagedStateStore } from "../../infrastructure/kv/managed-state.store.ts";
import { AppConfigService } from "../../services/app-config.service.ts";
import { CommonEmailConfigService } from "../../services/common-email-config.service.ts";
import { CommonLlmConfigService } from "../../services/common-llm-config.service.ts";
import { CommonPasswordConfigService } from "../../services/common-password-config.service.ts";
import { LlmHealthService } from "../../services/llm-health.service.ts";
import { LlmMetricsService } from "../../services/llm-metrics.service.ts";
import { LlmSmokeTestService } from "../../services/llm-smoke-test.service.ts";
import { ApplicationError, badRequest, conflict } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import type {
  AdminAppSummary,
  AdminBootstrapResult,
  AdminConfigDocument,
  AdminDeleteAppResult,
  AdminEmailServiceDocument,
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  AdminLlmSmokeTestDocument,
  AdminLlmServiceDocument,
  AdminPasswordDocument,
  AppRecord,
  LlmMetricsRange,
  RoleRecord,
} from "../../shared/types.ts";

const ADMIN_CONFIG_KEY = "admin.delivery_config";
const EMPTY_CONFIG_TEMPLATE = {};
const COMMON_APP_ID = "common";

export class AdminConsoleService {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly appConfigService: AppConfigService,
    private readonly commonEmailConfigService: CommonEmailConfigService,
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly commonPasswordConfigService: CommonPasswordConfigService,
    private readonly llmHealthService: LlmHealthService,
    private readonly llmMetricsService: LlmMetricsService,
    private readonly llmSmokeTestService: LlmSmokeTestService,
    private readonly managedStateStore: ManagedStateStore,
  ) {}

  getBootstrap(adminUser: string): AdminBootstrapResult {
    return {
      adminUser,
      apps: this.database.apps
        .map((app) => this.toSummary(app))
        .sort((left, right) => left.appName.localeCompare(right.appName, "zh-CN")),
    };
  }

  async getConfig(appId: string, revision?: number): Promise<AdminConfigDocument> {
    const app = this.requireConfigApp(appId);
    const revisions = await this.appConfigService.listRevisions(app.id, ADMIN_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(app.id, ADMIN_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(app.id, ADMIN_CONFIG_KEY);
    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Config revision ${revision} was not found.`);
    }
    const fallbackRecord = this.database.appConfigs.find(
      (item) => item.appId === app.id && item.configKey === ADMIN_CONFIG_KEY,
    );
    const rawJson = record ? this.normalizeConfig(record.content) : this.readNormalizedConfig(app.id);

    return {
      app: this.toSummary(app),
      configKey: ADMIN_CONFIG_KEY,
      rawJson,
      updatedAt: record?.createdAt ?? fallbackRecord?.updatedAt,
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async updateConfig(appId: string, rawJson: string, desc?: string): Promise<AdminConfigDocument> {
    const app = this.requireConfigApp(appId);
    const normalized = this.normalizeConfig(rawJson);

    await this.appConfigService.setValue(
      app.id,
      ADMIN_CONFIG_KEY,
      normalized,
      desc?.trim() || "admin-update",
    );
    await this.managedStateStore.save(this.database);

    return this.getConfig(app.id);
  }

  async restoreConfig(appId: string, revision: number): Promise<AdminConfigDocument> {
    const app = this.requireConfigApp(appId);
    const existing = await this.appConfigService.getRevision(app.id, ADMIN_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Config revision ${revision} was not found.`);
    }
    await this.appConfigService.restoreValue(app.id, ADMIN_CONFIG_KEY, revision, `恢复到版本 R${revision}`);
    await this.managedStateStore.save(this.database);
    return this.getConfig(app.id);
  }

  async createApp(appId: string, appName?: string): Promise<AdminAppSummary> {
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
    await this.appConfigService.setValue(
      record.id,
      ADMIN_CONFIG_KEY,
      JSON.stringify(EMPTY_CONFIG_TEMPLATE, null, 2),
      "app-created",
    );
    await this.managedStateStore.save(this.database);

    return this.toSummary(record);
  }

  async deleteApp(appId: string): Promise<AdminDeleteAppResult> {
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
    await this.appConfigService.deleteByApp(app.id);
    await this.managedStateStore.save(this.database);

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

  private requireConfigApp(appId: string): AppRecord {
    if (appId === COMMON_APP_ID) {
      throw new ApplicationError(404, "APP_NOT_FOUND", "App common does not have app-scoped config.");
    }

    return this.requireApp(appId);
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

  async getEmailServiceConfig(revision?: number): Promise<AdminEmailServiceDocument> {
    return this.commonEmailConfigService.getDocument(revision);
  }

  async updateEmailServiceConfig(input: unknown, desc?: string): Promise<AdminEmailServiceDocument> {
    const document = await this.commonEmailConfigService.updateConfig(input, desc);
    await this.managedStateStore.save(this.database);
    return document;
  }

  async restoreEmailServiceConfig(revision: number): Promise<AdminEmailServiceDocument> {
    const document = await this.commonEmailConfigService.restoreConfig(revision);
    await this.managedStateStore.save(this.database);
    return document;
  }

  async getPasswordConfig(): Promise<AdminPasswordDocument> {
    return this.commonPasswordConfigService.getDocument();
  }

  async updatePasswordConfig(input: unknown): Promise<AdminPasswordDocument> {
    return this.commonPasswordConfigService.updateConfig(input);
  }

  async getLlmServiceConfig(revision?: number): Promise<AdminLlmServiceDocument> {
    const document = await this.commonLlmConfigService.getDocument(revision);
    const runtime = {
      generatedAt: new Date().toISOString(),
      models: await Promise.all(
        document.config.models.map((model) => this.llmHealthService.buildModelRuntimeStatus(model)),
      ),
    };

    return {
      ...document,
      runtime,
    };
  }

  async updateLlmServiceConfig(input: unknown, desc?: string): Promise<AdminLlmServiceDocument> {
    const document = await this.commonLlmConfigService.updateConfig(input, desc);
    await this.managedStateStore.save(this.database);
    return this.getLlmServiceConfig(document.revision);
  }

  async restoreLlmServiceConfig(revision: number): Promise<AdminLlmServiceDocument> {
    const document = await this.commonLlmConfigService.restoreConfig(revision);
    await this.managedStateStore.save(this.database);
    return this.getLlmServiceConfig(document.revision);
  }

  async getLlmMetrics(range: LlmMetricsRange): Promise<AdminLlmMetricsDocument> {
    return this.llmMetricsService.getOverview(this.commonLlmConfigService.getCurrentConfig(), range);
  }

  async getLlmModelMetrics(modelKey: string, range: LlmMetricsRange): Promise<AdminLlmModelMetricsDocument> {
    return this.llmMetricsService.getModelDetail(this.commonLlmConfigService.getCurrentConfig(), modelKey, range);
  }

  async runLlmSmokeTest(): Promise<AdminLlmSmokeTestDocument> {
    return this.llmSmokeTestService.run();
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
