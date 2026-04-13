import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { ManagedStateStore } from "../../infrastructure/kv/managed-state.store.ts";
import { VersionedAppConfigService } from "../../services/versioned-app-config.service.ts";
import { AppI18nConfigService } from "../../services/app-i18n-config.service.ts";
import { AppAiRoutingConfigService, AI_NOVEL_APP_ID } from "../../services/app-ai-routing-config.service.ts";
import { AppLogSecretService } from "../../services/app-log-secret.service.ts";
import { AppRemoteLogPullService } from "../../services/app-remote-log-pull.service.ts";
import { CommonEmailConfigService } from "../../services/common-email-config.service.ts";
import { CommonLlmConfigService } from "../../services/common-llm-config.service.ts";
import { CommonPasswordConfigService } from "../../services/common-password-config.service.ts";
import { EmailTestSendService } from "../../services/email-test-send.service.ts";
import { LlmHealthService } from "../../services/llm-health.service.ts";
import { LlmMetricsService } from "../../services/llm-metrics.service.ts";
import { LlmSmokeTestService } from "../../services/llm-smoke-test.service.ts";
import { RefreshTokenStore } from "../../services/refresh-token-store.ts";
import { SmsVerificationRecordService } from "../../services/sms-verification-record.service.ts";
import { createAppNameI18n, normalizeAppNameI18n, resolveAdminAppName } from "../../shared/app-name.ts";
import { ApplicationError, badRequest, conflict } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import type {
  AdminAiRoutingDocument,
  AdminAppSummary,
  AdminAppI18nDocument,
  AdminAppLogSecretRevealDocument,
  AdminAppRemoteLogPullSettingsDocument,
  AdminAppRemoteLogPullTaskListDocument,
  AdminRemoteLogPullTaskDocument,
  AdminRemoteLogPullTaskFileDocument,
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
  AdminPasswordRevealDocument,
  AdminSmsVerificationListDocument,
  AdminSmsVerificationRevealDocument,
  AppRecord,
  LlmMetricsRange,
  PublicAppConfigDocument,
  RoleRecord,
} from "../../shared/types.ts";

const ADMIN_CONFIG_KEY = "admin.delivery_config";
const COMMON_APP_ID = "common";
const APP_ID_PATTERN = /^[a-z0-9_]+$/;

export class AdminConsoleService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly appConfigService: VersionedAppConfigService,
    private readonly appI18nConfigService: AppI18nConfigService,
    private readonly appAiRoutingConfigService: AppAiRoutingConfigService,
    private readonly appRemoteLogPullService: AppRemoteLogPullService,
    private readonly appLogSecretService: AppLogSecretService,
    private readonly commonEmailConfigService: CommonEmailConfigService,
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly commonPasswordConfigService: CommonPasswordConfigService,
    private readonly emailTestSendService: EmailTestSendService,
    private readonly llmHealthService: LlmHealthService,
    private readonly llmMetricsService: LlmMetricsService,
    private readonly llmSmokeTestService: LlmSmokeTestService,
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly smsVerificationRecordService: SmsVerificationRecordService,
    private readonly managedStateStore: ManagedStateStore,
  ) {}

  async getBootstrap(adminUser: string): Promise<AdminBootstrapResult> {
    const apps = await this.database.listApps();
    return {
      adminUser,
      apps: (await Promise.all(apps.map((app) => this.toSummary(app))))
        .sort((left, right) => left.appName.localeCompare(right.appName, "zh-CN")),
    };
  }

  async getConfig(appId: string, revision?: number): Promise<AdminConfigDocument> {
    const app = await this.requireConfigApp(appId);
    const revisions = await this.appConfigService.listRevisions(app.id, ADMIN_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(app.id, ADMIN_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(app.id, ADMIN_CONFIG_KEY);
    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Config revision ${revision} was not found.`);
    }
    const rawJson = record ? this.normalizeConfig(record.content) : await this.readNormalizedConfig(app.id);

    return {
      app: await this.toSummary(app),
      configKey: ADMIN_CONFIG_KEY,
      rawJson,
      updatedAt: record?.createdAt ?? await this.appConfigService.getUpdatedAt(app.id, ADMIN_CONFIG_KEY),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async getAiRouting(appId: string, revision?: number): Promise<AdminAiRoutingDocument> {
    const app = await this.requireConfigApp(appId);
    return this.appAiRoutingConfigService.getDocument(await this.toSummary(app), revision);
  }

  async updateAiRouting(appId: string, rawJson: string, desc?: string): Promise<AdminAiRoutingDocument> {
    const app = await this.requireConfigApp(appId);
    await this.appAiRoutingConfigService.updateConfig(app.id, rawJson, desc);
    await this.managedStateStore.save(this.database);
    return this.appAiRoutingConfigService.getDocument(await this.toSummary(app));
  }

  async restoreAiRouting(appId: string, revision: number, desc?: string): Promise<AdminAiRoutingDocument> {
    const app = await this.requireConfigApp(appId);
    await this.appAiRoutingConfigService.restoreConfig(app.id, revision, desc);
    await this.managedStateStore.save(this.database);
    return this.appAiRoutingConfigService.getDocument(await this.toSummary(app));
  }

  async getPublicConfig(appId: string): Promise<PublicAppConfigDocument> {
    const app = await this.requireApp(appId);
    if (app.id === COMMON_APP_ID) {
      throw new ApplicationError(404, "APP_NOT_FOUND", "App common does not expose public config.");
    }

    if (app.status === "BLOCKED") {
      throw new ApplicationError(403, "APP_BLOCKED", "The app is blocked.");
    }

    const rawJson = await this.readNormalizedConfig(app.id);

    return {
      appId: app.id,
      config: JSON.parse(rawJson) as Record<string, unknown>,
      updatedAt: await this.appConfigService.getUpdatedAt(app.id, ADMIN_CONFIG_KEY),
    };
  }

  async updateConfig(appId: string, rawJson: string, desc?: string): Promise<AdminConfigDocument> {
    const app = await this.requireConfigApp(appId);
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

  async restoreConfig(appId: string, revision: number, desc?: string): Promise<AdminConfigDocument> {
    const app = await this.requireConfigApp(appId);
    const existing = await this.appConfigService.getRevision(app.id, ADMIN_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Config revision ${revision} was not found.`);
    }
    await this.appConfigService.restoreValue(app.id, ADMIN_CONFIG_KEY, revision, desc?.trim() || `恢复到版本 R${revision}`);
    await this.managedStateStore.save(this.database);
    return this.getConfig(app.id);
  }

  async createApp(appId: string, appNameZhCn: string, appNameEnUs: string): Promise<AdminAppSummary> {
    const normalizedId = appId.trim();
    if (!normalizedId) {
      badRequest("REQ_INVALID_BODY", "appId must be a non-empty string.");
    }

    if (!APP_ID_PATTERN.test(normalizedId)) {
      badRequest("REQ_INVALID_BODY", "appId must contain only lowercase letters, numbers, and underscores.");
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

    if (await this.database.findApp(normalizedId)) {
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

    await this.database.insertApp(record);
    await this.createDefaultRoles(record.id);
    await this.appLogSecretService.ensureSecret(record.id);
    const defaultConfig = this.buildDefaultConfigTemplate(record.id);
    await this.appConfigService.setValue(
      record.id,
      ADMIN_CONFIG_KEY,
      JSON.stringify(defaultConfig, null, 2),
      "app-created",
    );
    await this.appI18nConfigService.initializeAppConfig(record.id, "app-created");
    await this.appRemoteLogPullService.initializeAppConfig(record.id, "app-created");
    if (record.id === AI_NOVEL_APP_ID) {
      await this.appAiRoutingConfigService.initializeAppConfig(record.id, "app-created");
    }
    await this.managedStateStore.save(this.database);

    return this.toSummary(record);
  }

  async updateAppNames(appId: string, appNameI18n: unknown): Promise<AdminAppSummary> {
    const app = await this.requireApp(appId);
    const normalizedNames = this.normalizeRequiredAppNames(appNameI18n);
    await this.database.updateAppNames(app.id, normalizedNames["en-US"], normalizedNames);
    await this.managedStateStore.save(this.database);
    return await this.toSummary({
      ...app,
      name: normalizedNames["en-US"],
      nameI18n: normalizedNames,
    });
  }

  async revealAppLogSecret(appId: string): Promise<AdminAppLogSecretRevealDocument> {
    const app = await this.requireApp(appId);
    const ensured = await this.appLogSecretService.ensureSecret(app.id);
    if (ensured.created) {
      await this.managedStateStore.save(this.database);
    }

    return {
      app: await this.toSummary(app),
      keyId: ensured.record.keyId,
      secret: ensured.record.secret,
      updatedAt: ensured.record.updatedAt,
    };
  }

  async deleteApp(appId: string): Promise<AdminDeleteAppResult> {
    if (appId === COMMON_APP_ID) {
      conflict("ADMIN_APP_ID_RESERVED", "App ID common is reserved.");
    }

    const app = await this.requireApp(appId);

    if (!(await this.isDeleteAllowed(app.id))) {
      conflict(
        "ADMIN_APP_DELETE_REQUIRES_EMPTY_CONFIG",
        "Config must be an empty JSON object before deleting the app.",
      );
    }

    await this.database.deleteApp(app.id);
    await this.appConfigService.deleteByApp(app.id);
    await this.refreshTokenStore.deleteByApp(app.id);
    await this.managedStateStore.save(this.database);

    return {
      deleted: true,
      appId: app.id,
    };
  }

  async revealPasswordValue(key: string): Promise<AdminPasswordRevealDocument> {
    return this.commonPasswordConfigService.revealValue(key);
  }

  async listSmsVerificationRecords(filterAppId?: string): Promise<AdminSmsVerificationListDocument> {
    return this.smsVerificationRecordService.listForAdmin(await this.commonAppSummary(), filterAppId);
  }

  async revealSmsVerificationRecord(recordId: string): Promise<AdminSmsVerificationRevealDocument> {
    return this.smsVerificationRecordService.revealForAdmin(await this.commonAppSummary(), recordId);
  }

  private async requireApp(appId: string): Promise<AppRecord> {
    const app = await this.database.findApp(appId);
    if (!app) {
      throw new ApplicationError(404, "APP_NOT_FOUND", `App ${appId} was not found.`);
    }

    return app;
  }

  private async requireConfigApp(appId: string): Promise<AppRecord> {
    if (appId === COMMON_APP_ID) {
      throw new ApplicationError(404, "APP_NOT_FOUND", "App common does not have app-scoped config.");
    }

    return await this.requireApp(appId);
  }

  private async readNormalizedConfig(appId: string): Promise<string> {
    const stored = await this.appConfigService.getValue(appId, ADMIN_CONFIG_KEY);
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

  private async isDeleteAllowed(appId: string): Promise<boolean> {
    if (appId === COMMON_APP_ID) {
      return false;
    }

    const raw = await this.appConfigService.getValue(appId, ADMIN_CONFIG_KEY);
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

  async restoreEmailServiceConfig(revision: number, desc?: string): Promise<AdminEmailServiceDocument> {
    const document = await this.commonEmailConfigService.restoreConfig(revision, desc);
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
    const app = await this.requireConfigApp(appId);
    const document = await this.appI18nConfigService.getDocument(app.id, revision);

    return {
      app: await this.toSummary(app),
      ...document,
    };
  }

  async getRemoteLogPullSettings(
    appId: string,
    revision?: number,
  ): Promise<AdminAppRemoteLogPullSettingsDocument> {
    const app = await this.requireConfigApp(appId);
    const document = await this.appRemoteLogPullService.getDocument(app.id, revision);
    return {
      app: await this.toSummary(app),
      ...document,
    };
  }

  async getAiRoutingSettings(appId: string, revision?: number): Promise<AdminAiRoutingDocument> {
    return this.getAiRouting(appId, revision);
  }

  async updateRemoteLogPullSettings(
    appId: string,
    input: unknown,
    desc?: string,
  ): Promise<AdminAppRemoteLogPullSettingsDocument> {
    const app = await this.requireConfigApp(appId);
    const document = await this.appRemoteLogPullService.updateConfig(app.id, input, desc);
    await this.managedStateStore.save(this.database);
    return await this.getRemoteLogPullSettings(app.id, document.revision);
  }

  async restoreRemoteLogPullSettings(
    appId: string,
    revision: number,
    desc?: string,
  ): Promise<AdminAppRemoteLogPullSettingsDocument> {
    const app = await this.requireConfigApp(appId);
    const document = await this.appRemoteLogPullService.restoreConfig(app.id, revision, desc);
    await this.managedStateStore.save(this.database);
    return await this.getRemoteLogPullSettings(app.id, document.revision);
  }

  async listRemoteLogPullTasks(appId: string): Promise<AdminAppRemoteLogPullTaskListDocument> {
    const app = await this.requireConfigApp(appId);
    return {
      app: await this.toSummary(app),
      items: await this.appRemoteLogPullService.listTasks(app.id),
    };
  }

  async createRemoteLogPullTask(appId: string, input: unknown): Promise<AdminAppRemoteLogPullTaskListDocument> {
    const app = await this.requireConfigApp(appId);
    await this.appRemoteLogPullService.createTask(app.id, input);
    await this.managedStateStore.save(this.database);
    return await this.listRemoteLogPullTasks(app.id);
  }

  async cancelRemoteLogPullTask(appId: string, taskId: string): Promise<AdminAppRemoteLogPullTaskListDocument> {
    const app = await this.requireConfigApp(appId);
    await this.appRemoteLogPullService.cancelTask(app.id, taskId);
    await this.managedStateStore.save(this.database);
    return await this.listRemoteLogPullTasks(app.id);
  }

  async getRemoteLogPullTaskFile(appId: string, taskId: string): Promise<AdminRemoteLogPullTaskFileDocument> {
    const app = await this.requireConfigApp(appId);
    return await this.appRemoteLogPullService.getTaskFile(app.id, taskId);
  }

  async getRemoteLogPullTask(appId: string, taskId: string): Promise<AdminRemoteLogPullTaskDocument> {
    const app = await this.requireConfigApp(appId);
    return {
      app: await this.toSummary(app),
      item: await this.appRemoteLogPullService.getTask(app.id, taskId),
    };
  }

  async updateI18nSettings(appId: string, input: unknown, desc?: string): Promise<AdminAppI18nDocument> {
    const app = await this.requireConfigApp(appId);
    const document = await this.appI18nConfigService.updateConfig(app.id, input, desc);
    await this.managedStateStore.save(this.database);
    return this.getI18nSettings(app.id, document.revision);
  }

  async restoreI18nSettings(appId: string, revision: number, desc?: string): Promise<AdminAppI18nDocument> {
    const app = await this.requireConfigApp(appId);
    const document = await this.appI18nConfigService.restoreConfig(app.id, revision, desc);
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

  async restoreLlmServiceConfig(revision: number, desc?: string): Promise<AdminLlmServiceDocument> {
    const document = await this.commonLlmConfigService.restoreConfig(revision, desc);
    await this.managedStateStore.save(this.database);
    return this.getLlmServiceConfig(document.revision);
  }

  async getLlmMetrics(range: LlmMetricsRange): Promise<AdminLlmMetricsDocument> {
    return this.llmMetricsService.getOverview(await this.commonLlmConfigService.getCurrentConfig(), range);
  }

  async getLlmModelMetrics(modelKey: string, range: LlmMetricsRange): Promise<AdminLlmModelMetricsDocument> {
    return this.llmMetricsService.getModelDetail(
      await this.commonLlmConfigService.getCurrentConfig(),
      modelKey,
      range,
    );
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

  private async commonAppSummary(): Promise<AdminAppSummary> {
    return {
      appId: COMMON_APP_ID,
      appCode: COMMON_APP_ID,
      appName: "Common",
      appNameI18n: {
        "zh-CN": "公共工作区",
        "en-US": "Common",
      },
      status: "ACTIVE",
      canDelete: false,
      logSecret: {
        keyId: COMMON_APP_ID,
        secretMasked: "internal",
        updatedAt: new Date(0).toISOString(),
      },
    };
  }

  private async toSummary(app: AppRecord): Promise<AdminAppSummary> {
    const logSecret = await this.appLogSecretService.getSummary(app.id);
    if (!logSecret) {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", `App ${app.id} log secret is missing.`);
    }

    return {
      appId: app.id,
      appCode: app.code,
      appName: resolveAdminAppName(app.nameI18n, app.name),
      appNameI18n: normalizeAppNameI18n(app.nameI18n, app.name),
      status: app.status,
      canDelete: await this.isDeleteAllowed(app.id),
      logSecret,
    };
  }
  private async createDefaultRoles(appId: string): Promise<void> {
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

    await this.database.insertRoles([memberRole, adminRole]);

    const permissionMap = new Map((await this.database.listPermissions()).map((item) => [item.code, item.id]));
    const memberPermissions = ["file:read"];
    const adminPermissions = ["file:read", "metrics:read", "notification:send"];
    const rolePermissionRecords = [];

    memberPermissions.forEach((code) => {
      const permissionId = permissionMap.get(code);
      if (!permissionId) {
        return;
      }

      rolePermissionRecords.push({
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

      rolePermissionRecords.push({
        id: randomId(`rp_${appId}_admin`),
        roleId: adminRole.id,
        permissionId,
      });
    });
    await this.database.insertRolePermissions(rolePermissionRecords);
  }
}
