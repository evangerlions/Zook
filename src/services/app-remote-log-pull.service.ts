import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { AppLogSecretService } from "./app-log-secret.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import { randomId } from "../shared/utils.ts";
import type {
  AdminAppRemoteLogPullTaskListDocument,
  AdminRemoteLogPullTaskSummary,
  ClientLogUploadTaskRecord,
  ConfigRevisionMeta,
  RemoteLogPullSettings,
  RemoteLogPullSettingsDocument,
} from "../shared/types.ts";

export const REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY = "remote_log_pull.settings";

const DEFAULT_REMOTE_LOG_PULL_SETTINGS: RemoteLogPullSettings = {
  enabled: false,
  minPullIntervalSeconds: 1800,
  claimTtlSeconds: 300,
  taskDefaults: {
    lookbackMinutes: 60,
    maxLines: 2000,
    maxBytes: 1024 * 1024,
  },
};

export class AppRemoteLogPullService {
  constructor(
    private readonly appConfigService: VersionedAppConfigService,
    private readonly database: ApplicationDatabase,
    private readonly appLogSecretService: AppLogSecretService,
  ) {}

  async getDocument(appId: string, revision?: number): Promise<RemoteLogPullSettingsDocument> {
    const revisions = await this.appConfigService.listRevisions(appId, REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(appId, REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(appId, REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY);

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Remote Log Pull revision ${revision} was not found.`);
    }

    const config = record ? this.parseConfig(record.content) : await this.getCurrentConfig(appId);
    return this.createDocument(config, revisions, {
      updatedAt: record?.createdAt ?? await this.appConfigService.getUpdatedAt(appId, REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
    });
  }

  async updateConfig(appId: string, input: unknown, desc?: string): Promise<RemoteLogPullSettingsDocument> {
    const normalized = this.validateInput(input);
    await this.appConfigService.setValue(
      appId,
      REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "remote-log-pull-settings-update",
    );
    return await this.getDocument(appId);
  }

  async restoreConfig(appId: string, revision: number): Promise<RemoteLogPullSettingsDocument> {
    const existing = await this.appConfigService.getRevision(appId, REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Remote Log Pull revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      appId,
      REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY,
      revision,
      `恢复到版本 R${revision}`,
    );
    return await this.getDocument(appId);
  }

  async getCurrentConfig(appId: string): Promise<RemoteLogPullSettings> {
    const stored = await this.appConfigService.getValue(appId, REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY);
    return stored ? this.parseConfig(stored) : this.createDefaultConfig();
  }

  async initializeAppConfig(appId: string, desc = "app-created"): Promise<void> {
    await this.appConfigService.setValue(
      appId,
      REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY,
      JSON.stringify(this.createDefaultConfig(), null, 2),
      desc,
    );
  }

  async initializeMissingConfigs(appIds: string[], desc = "init-default-remote-log-pull"): Promise<boolean> {
    let created = false;
    for (const appId of appIds) {
      const existing = await this.appConfigService.getValue(appId, REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY);
      if (existing) {
        continue;
      }

      await this.initializeAppConfig(appId, desc);
      created = true;
    }

    return created;
  }

  createDefaultConfig(): RemoteLogPullSettings {
    return structuredClone(DEFAULT_REMOTE_LOG_PULL_SETTINGS);
  }

  async listTasks(appId: string): Promise<AdminRemoteLogPullTaskSummary[]> {
    return (await this.database.listClientLogUploadTasks(appId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((item) => this.toTaskSummary(item));
  }

  async createTask(appId: string, input: unknown, now = new Date()): Promise<AdminRemoteLogPullTaskSummary> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("REQ_INVALID_BODY", "Remote Log Pull task must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const userId = typeof source.userId === "string" ? source.userId.trim() : "";
    const clientId = typeof source.clientId === "string" ? source.clientId.trim() : "";
    if (!userId) {
      badRequest("REQ_INVALID_BODY", "userId must be a non-empty string.");
    }
    if (!clientId) {
      badRequest("REQ_INVALID_BODY", "clientId must be a non-empty string.");
    }

    const settings = await this.getCurrentConfig(appId);
    const secret = (await this.appLogSecretService.ensureSecret(appId)).record;
    const toTsMs = now.getTime();
    const fromTsMs = toTsMs - settings.taskDefaults.lookbackMinutes * 60 * 1000;
    const record: ClientLogUploadTaskRecord = {
      id: randomId("log_task"),
      appId,
      userId,
      clientId,
      keyId: secret.keyId,
      fromTsMs,
      toTsMs,
      maxLines: settings.taskDefaults.maxLines,
      maxBytes: settings.taskDefaults.maxBytes,
      status: "PENDING",
      createdAt: now.toISOString(),
    };

    await this.database.insertClientLogUploadTask(record);
    return this.toTaskSummary(record);
  }

  async cancelTask(appId: string, taskId: string): Promise<AdminRemoteLogPullTaskSummary> {
    const task = await this.database.findClientLogUploadTask(taskId);
    if (!task || task.appId !== appId) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Remote Log Pull task ${taskId} was not found.`);
    }

    await this.database.updateClientLogUploadTask(task.id, {
      status: "CANCELLED",
      claimToken: undefined,
      claimExpireAt: undefined,
    });

    return this.toTaskSummary({
      ...task,
      status: "CANCELLED",
      claimToken: undefined,
      claimExpireAt: undefined,
    });
  }

  private createDocument(
    config: RemoteLogPullSettings,
    revisions: ConfigRevisionMeta[],
    meta: {
      updatedAt?: string;
      revision?: number;
      desc?: string;
      isLatest: boolean;
    },
  ): RemoteLogPullSettingsDocument {
    return {
      configKey: REMOTE_LOG_PULL_SETTINGS_CONFIG_KEY,
      config,
      updatedAt: meta.updatedAt,
      revision: meta.revision,
      desc: meta.desc,
      isLatest: meta.isLatest,
      revisions: [...revisions].reverse(),
    };
  }

  private parseConfig(raw: string): RemoteLogPullSettings {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored Remote Log Pull config is invalid.");
    }
    return this.validateInput(parsed);
  }

  private validateInput(input: unknown): RemoteLogPullSettings {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("REQ_INVALID_BODY", "Remote Log Pull settings must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const taskDefaults =
      source.taskDefaults && typeof source.taskDefaults === "object" && !Array.isArray(source.taskDefaults)
        ? (source.taskDefaults as Record<string, unknown>)
        : {};

    return {
      enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_REMOTE_LOG_PULL_SETTINGS.enabled,
      minPullIntervalSeconds: this.requirePositiveInteger(
        source.minPullIntervalSeconds,
        "minPullIntervalSeconds must be a positive integer.",
        DEFAULT_REMOTE_LOG_PULL_SETTINGS.minPullIntervalSeconds,
      ),
      claimTtlSeconds: this.requirePositiveInteger(
        source.claimTtlSeconds,
        "claimTtlSeconds must be a positive integer.",
        DEFAULT_REMOTE_LOG_PULL_SETTINGS.claimTtlSeconds,
      ),
      taskDefaults: {
        lookbackMinutes: this.requirePositiveInteger(
          taskDefaults.lookbackMinutes,
          "taskDefaults.lookbackMinutes must be a positive integer.",
          DEFAULT_REMOTE_LOG_PULL_SETTINGS.taskDefaults.lookbackMinutes,
        ),
        maxLines: this.requirePositiveInteger(
          taskDefaults.maxLines,
          "taskDefaults.maxLines must be a positive integer.",
          DEFAULT_REMOTE_LOG_PULL_SETTINGS.taskDefaults.maxLines,
        ),
        maxBytes: this.requirePositiveInteger(
          taskDefaults.maxBytes,
          "taskDefaults.maxBytes must be a positive integer.",
          DEFAULT_REMOTE_LOG_PULL_SETTINGS.taskDefaults.maxBytes,
        ),
      },
    };
  }

  private requirePositiveInteger(value: unknown, message: string, fallback: number): number {
    if (value === undefined) {
      return fallback;
    }

    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      badRequest("REQ_INVALID_BODY", message);
    }

    return value;
  }

  private toTaskSummary(task: ClientLogUploadTaskRecord): AdminRemoteLogPullTaskSummary {
    return {
      taskId: task.id,
      userId: task.userId ?? "",
      clientId: task.clientId ?? "",
      keyId: task.keyId,
      status: task.status,
      fromTsMs: task.fromTsMs,
      toTsMs: task.toTsMs,
      maxLines: task.maxLines,
      maxBytes: task.maxBytes,
      claimExpireAt: task.claimExpireAt,
      uploadedAt: task.uploadedAt,
      createdAt: task.createdAt,
    };
  }
}
