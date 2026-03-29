import { randomBytes } from "node:crypto";
import { InMemoryDatabase } from "../infrastructure/database/prisma/in-memory-database.ts";
import type {
  AdminAppLogSecretRevealDocument,
  AdminAppLogSecretSummary,
  AdminAppSummary,
} from "../shared/types.ts";
import { maskSensitiveString, randomId } from "../shared/utils.ts";
import { AppConfigService } from "./app-config.service.ts";
import type { ClientLogEncryptionKeyResolver } from "./client-log-upload.service.ts";

export const APP_LOG_SECRET_CONFIG_KEY = "logs.client_upload_secret";
export const APP_LOG_SECRET_READ_OPERATION = "app.log_secret.read";

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
    private readonly database: InMemoryDatabase,
    private readonly appConfigService: AppConfigService,
  ) {}

  initializeSecrets(appIds: string[], now = new Date()): boolean {
    let changed = false;
    for (const appId of appIds) {
      const ensured = this.ensureSecret(appId, now);
      changed = changed || ensured.created;
    }

    return changed;
  }

  ensureSecret(appId: string, now = new Date()): EnsureAppLogSecretResult {
    const existing = this.readRecord(appId);
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

    this.appConfigService.setDirectValue(
      appId,
      APP_LOG_SECRET_CONFIG_KEY,
      JSON.stringify(record, null, 2),
      timestamp,
    );

    return {
      created: true,
      record,
    };
  }

  getSummary(appId: string): AdminAppLogSecretSummary | undefined {
    const record = this.readRecord(appId);
    if (!record) {
      return undefined;
    }

    return {
      keyId: record.keyId,
      secretMasked: maskSensitiveString(record.secret),
      updatedAt: record.updatedAt,
    };
  }

  revealSecret(app: AdminAppSummary, now = new Date()): EnsureAppLogSecretResult & { document: AdminAppLogSecretRevealDocument } {
    const ensured = this.ensureSecret(app.appId, now);
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

  resolveKey(keyId: string): Buffer | undefined {
    const normalizedKeyId = keyId.trim();
    if (!normalizedKeyId) {
      return undefined;
    }

    for (const app of this.database.apps) {
      const record = this.readRecord(app.id);
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

  private readRecord(appId: string): StoredAppLogSecret | undefined {
    const raw = this.appConfigService.getValue(appId, APP_LOG_SECRET_CONFIG_KEY);
    if (!raw) {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
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
