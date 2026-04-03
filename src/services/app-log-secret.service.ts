import { randomBytes } from "node:crypto";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type {
  AdminAppLogSecretRevealDocument,
  AdminAppLogSecretSummary,
  AdminAppSummary,
} from "../shared/types.ts";
import { maskSensitiveString, randomId } from "../shared/utils.ts";
import type { ClientLogEncryptionKeyResolver } from "./client-log-upload.service.ts";

export const APP_LOG_SECRET_CONFIG_KEY = "logs.client_upload_secret";
export const APP_LOG_SECRET_READ_OPERATION = "app.log_secret.read";
const APP_LOG_SECRET_SCOPE = "app-log-secrets";

interface StoredAppLogSecret {
  keyId: string;
  secret: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnsureAppLogSecretResult {
  created: boolean;
  record: StoredAppLogSecret;
}

export class AppLogSecretService implements ClientLogEncryptionKeyResolver {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kvManager: KVManager,
  ) {}

  async initializeSecrets(appIds: string[], now = new Date()): Promise<boolean> {
    let changed = false;
    for (const appId of appIds) {
      const ensured = await this.ensureSecret(appId, now);
      changed = changed || ensured.created;
    }

    return changed;
  }

  async ensureSecret(appId: string, now = new Date()): Promise<EnsureAppLogSecretResult> {
    const existing = await this.readRecord(appId);
    if (existing) {
      return {
        created: false,
        record: existing,
      };
    }

    const timestamp = now.toISOString();
    const record: StoredAppLogSecret = {
      keyId: randomId("logk"),
      secret: randomBytes(32).toString("base64"),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.kvManager.setJson(APP_LOG_SECRET_SCOPE, appId, record);

    return {
      created: true,
      record,
    };
  }

  async getSummary(appId: string): Promise<AdminAppLogSecretSummary | undefined> {
    const record = await this.readRecord(appId);
    if (!record) {
      return undefined;
    }

    return {
      keyId: record.keyId,
      secretMasked: maskSensitiveString(record.secret),
      updatedAt: record.updatedAt,
    };
  }

  async revealSecret(
    app: AdminAppSummary,
    now = new Date(),
  ): Promise<EnsureAppLogSecretResult & { document: AdminAppLogSecretRevealDocument }> {
    const ensured = await this.ensureSecret(app.appId, now);
    return {
      ...ensured,
      document: {
        app: {
          ...app,
          logSecret: {
            keyId: ensured.record.keyId,
            secretMasked: maskSensitiveString(ensured.record.secret),
            updatedAt: ensured.record.updatedAt,
          },
        },
        keyId: ensured.record.keyId,
        secret: ensured.record.secret,
        updatedAt: ensured.record.updatedAt,
      },
    };
  }

  async resolveKey(keyId: string): Promise<Buffer | undefined> {
    const normalizedKeyId = keyId.trim();
    if (!normalizedKeyId) {
      return undefined;
    }

    for (const app of await this.database.listApps()) {
      const record = await this.readRecord(app.id);
      if (!record || record.keyId !== normalizedKeyId) {
        continue;
      }

      try {
        const secret = Buffer.from(record.secret, "base64");
        if (secret.length === 32) {
          return secret;
        }
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private async readRecord(appId: string): Promise<StoredAppLogSecret | undefined> {
    const parsed = await this.kvManager.getJson<StoredAppLogSecret>(APP_LOG_SECRET_SCOPE, appId);
    if (!parsed) {
      return undefined;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const source = parsed as Record<string, unknown>;
    const keyId = typeof source.keyId === "string" ? source.keyId.trim() : "";
    const secret = typeof source.secret === "string" ? source.secret.trim() : "";
    const createdAt = typeof source.createdAt === "string" ? source.createdAt : "";
    const updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : createdAt;
    if (!keyId || !secret || !createdAt || !updatedAt) {
      return undefined;
    }

    return {
      keyId,
      secret,
      createdAt,
      updatedAt,
    };
  }
}
