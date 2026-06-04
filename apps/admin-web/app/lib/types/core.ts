

export interface RuntimeConfig {
  brandName: string;
  defaultAppId: string;
  version: string;
  healthPath: string;
  analyticsUrl: string;
  logsUrl: string;
}

export interface NoticeState {
  tone: "info" | "success" | "error";
  text: string;
}

export interface AdminAppLogSecretSummary {
  keyId: string;
  secretMasked: string;
  updatedAt: string;
}

export interface ConfigRevisionMeta {
  revision: number;
  desc: string;
  createdAt: string;
}

export interface AdminAppSummary {
  appId: string;
  appCode: string;
  appName: string;
  appNameI18n: {
    "zh-CN": string;
    "en-US": string;
    [locale: string]: string;
  };
  status: "ACTIVE" | "BLOCKED";
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
