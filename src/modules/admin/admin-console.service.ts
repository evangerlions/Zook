import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { ManagedStateStore } from "../../infrastructure/kv/managed-state.store.ts";
import { AppConfigService } from "../../services/app-config.service.ts";
import { AppI18nConfigService } from "../../services/app-i18n-config.service.ts";
import { AppLogSecretService } from "../../services/app-log-secret.service.ts";
import { CommonEmailConfigService } from "../../services/common-email-config.service.ts";
import { CommonLlmConfigService } from "../../services/common-llm-config.service.ts";
import { CommonPasswordConfigService } from "../../services/common-password-config.service.ts";
import { EmailTestSendService } from "../../services/email-test-send.service.ts";
import { LlmHealthService } from "../../services/llm-health.service.ts";
import { LlmMetricsService } from "../../services/llm-metrics.service.ts";
import { LlmSmokeTestService } from "../../services/llm-smoke-test.service.ts";
import { RefreshTokenStore } from "../../services/refresh-token-store.ts";
import { createAppNameI18n, normalizeAppNameI18n, resolveAdminAppName } from "../../shared/app-name.ts";
import { ApplicationError, badRequest, conflict } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import type {
  AdminAppSummary,
  AdminAppI18nDocument,
  AdminAppLogSecretRevealDocument,
  AdminBootstrapResult,
  AdminConfigDocument,
  AdminDeleteAppResult,
  AdminEmailServiceDocument,
  AdminEmailTestSendCommand,
  AdminEmailTestSendDocument,
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
const COMMON_APP_ID = "common";

export class AdminConsoleService {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly appConfigService: AppConfigService,
    private readonly appI18nConfigService: AppI18nConfigService,
    private readonly appLogSecretService: AppLogSecretService,
    private readonly commonEmailConfigService: CommonEmailConfigService,
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly commonPasswordConfigService: CommonPasswordConfigService,
    private readonly emailTestSendService: EmailTestSendService,
    private readonly llmHealthService: LlmHealthService,
    private readonly llmMetricsService: LlmMetricsService,
    private readonly llmSmokeTestService: LlmSmokeTestService,
    private readonly refreshTokenStore: RefreshTokenStore,
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

  async createApp(appId: string, appNameZhCn: string, appNameEnUs: string): Promise<AdminAppSummary> {
    const normalizedId = appId.trim();
    if (!normalizedId) {
      badRequest("REQ_INVALID_BODY", "appId must be a non-empty string.");
    }

    const normalizedZhCnName = appNameZhCn.trim();
    const normalizedEnUsName = appNameEnUs.trim();
    if (!normalizedZhCnName) {
      badRequest("REQ_INVALID_BODY", "appNameZhCn must be a non-empty string.");
    }

    if (!normalizedEnUsName) {
      badRequest("REQ_INVALID_BODY", "appNameEnUs must be a non-empty string.");
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
      name: normalizedEnUsName,
      nameI18n: createAppNameI18n(normalizedZhCnName, normalizedEnUsName),
      status: "ACTIVE",
      joinMode: "AUTO",
      createdAt: new Date().toISOString(),
    };

    this.database.apps.push(record);
    this.createDefaultRoles(record.id);
    this.appLogSecretService.ensureSecret(record.id);
    const defaultConfig = this.buildDefaultConfigTemplate(record.id);
    await this.appConfigService.setValue(
      record.id,
      ADMIN_CONFIG_KEY,
      JSON.stringify(defaultConfig, null, 2),
      "app-created",
    );
    await this.appI18nConfigService.initializeAppConfig(record.id, "app-created");
    await this.managedStateStore.save(this.database);

    return this.toSummary(record);
  }

  async updateAppNames(appId: string, appNameI18n: unknown): Promise<AdminAppSummary> {
    const app = this.requireApp(appId);
    const normalizedNames = this.normalizeRequiredAppNames(appNameI18n);
    app.name = normalizedNames["en-US"];
    app.nameI18n = normalizedNames;
    await this.managedStateStore.save(this.database);
    return this.toSummary(app);
  }

  async revealAppLogSecret(appId: string): Promise<AdminAppLogSecretRevealDocument> {
    const app = this.requireApp(appId);
    const ensured = this.appLogSecretService.ensureSecret(app.id);
    if (ensured.created) {
      await this.managedStateStore.save(this.database);
    }

    return {
      app: this.toSummary(app),
      keyId: ensured.record.keyId,
      secret: ensured.record.secret,
      updatedAt: ensured.record.updatedAt,
    };
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
    this.database.auditLogs = this.database.auditLogs.filter((item) => item.appId !== app.id);
    this.database.notificationJobs = this.database.notificationJobs.filter((item) => item.appId !== app.id);
    this.database.failedEvents = this.database.failedEvents.filter((item) => item.appId !== app.id);
    this.database.analyticsEvents = this.database.analyticsEvents.filter((item) => item.appId !== app.id);
    this.database.files = this.database.files.filter((item) => item.appId !== app.id);
    await this.appConfigService.deleteByApp(app.id);
    await this.refreshTokenStore.deleteByApp(app.id);
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
      return JSON.stringify(this.buildDefaultConfigTemplate(appId), null, 2);
    }

    return this.normalizeConfig(stored);
  }

  private normalizeRequiredAppNames(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest("REQ_INVALID_BODY", "appNameI18n must be a JSON object.");
    }

    const source = value as Record<string, unknown>;
    const zhCnName = typeof source["zh-CN"] === "string" ? source["zh-CN"].trim() : "";
    const enUsName = typeof source["en-US"] === "string" ? source["en-US"].trim() : "";
    if (!zhCnName) {
      badRequest("REQ_INVALID_BODY", "appNameI18n.zh-CN must be a non-empty string.");
    }

    if (!enUsName) {
      badRequest("REQ_INVALID_BODY", "appNameI18n.en-US must be a non-empty string.");
    }

    return normalizeAppNameI18n(source, enUsName);
  }

  private isDeleteAllowed(appId: string): boolean {
    if (appId === COMMON_APP_ID) {
      return false;
    }

    const raw = this.appConfigService.getValue(appId, ADMIN_CONFIG_KEY);
    if (!raw || !raw.trim()) {
      return true;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }

    return Object.keys(parsed as Record<string, unknown>).length === 0;
  }

  private buildDefaultConfigTemplate(appId: string): Record<string, string> {
    return {
      app: `make_${appId}_great_again`,
    };
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

  async sendEmailTest(input: AdminEmailTestSendCommand): Promise<AdminEmailTestSendDocument> {
    return this.emailTestSendService.run(input);
  }

  async getPasswordConfig(): Promise<AdminPasswordDocument> {
    return this.commonPasswordConfigService.getDocument();
  }

  async updatePasswordConfig(input: unknown): Promise<AdminPasswordDocument> {
    return this.commonPasswordConfigService.updateConfig(input);
  }

  async upsertPasswordItem(input: unknown): Promise<AdminPasswordDocument> {
    const document = await this.commonPasswordConfigService.upsertItem(input);
    await this.managedStateStore.save(this.database);
    return document;
  }

  async deletePasswordItem(key: string): Promise<AdminPasswordDocument> {
    const document = await this.commonPasswordConfigService.deleteItem(key);
    await this.managedStateStore.save(this.database);
    return document;
  }

  async getI18nSettings(appId: string, revision?: number): Promise<AdminAppI18nDocument> {
    const app = this.requireConfigApp(appId);
    const document = await this.appI18nConfigService.getDocument(app.id, revision);

    return {
      app: this.toSummary(app),
      ...document,
    };
  }

  async updateI18nSettings(appId: string, input: unknown, desc?: string): Promise<AdminAppI18nDocument> {
    const app = this.requireConfigApp(appId);
    const document = await this.appI18nConfigService.updateConfig(app.id, input, desc);
    await this.managedStateStore.save(this.database);
    return this.getI18nSettings(app.id, document.revision);
  }

  async restoreI18nSettings(appId: string, revision: number): Promise<AdminAppI18nDocument> {
    const app = this.requireConfigApp(appId);
    const document = await this.appI18nConfigService.restoreConfig(app.id, revision);
    await this.managedStateStore.save(this.database);
    return this.getI18nSettings(app.id, document.revision);
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
    const logSecret = this.appLogSecretService.getSummary(app.id);
    if (!logSecret) {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", `App ${app.id} log secret is missing.`);
    }

    return {
      appId: app.id,
      appCode: app.code,
      appName: resolveAdminAppName(app.nameI18n, app.name),
      appNameI18n: normalizeAppNameI18n(app.nameI18n, app.name),
      status: app.status,
      canDelete: this.isDeleteAllowed(app.id),
      logSecret,
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
