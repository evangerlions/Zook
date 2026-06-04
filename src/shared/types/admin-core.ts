import type { AppStatus } from "./enums.ts";
import type { AppNameI18n, ConfigRevisionMeta } from "./records.ts";

export interface AdminAppLogSecretSummary {
  keyId: string;
  secretMasked: string;
  updatedAt: string;
}

export interface AdminAppSummary {
  appId: string;
  appCode: string;
  appName: string;
  appNameI18n: AppNameI18n;
  status: AppStatus;
  canDelete: boolean;
  logSecret: AdminAppLogSecretSummary;
}

export interface AdminBootstrapResult {
  adminUser: string;
  apps: AdminAppSummary[];
  sessionExpiresAt?: string;
}

export interface AdminAppLogSecretRevealDocument {
  app: AdminAppSummary;
  keyId: string;
  secret: string;
  updatedAt: string;
}

export interface AdminSensitiveOperationCodeRequestDocument {
  operation: string;
  recipientEmailMasked: string;
  cooldownSeconds: number;
  expiresInSeconds: number;
}

export interface AdminSensitiveOperationGrantDocument {
  operation: string;
  granted: true;
  expiresAt: string;
}

export interface AdminConfigDocument {
  app: AdminAppSummary;
  configKey: string;
  rawJson: string;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminDeleteAppResult {
  deleted: true;
  appId: string;
}
