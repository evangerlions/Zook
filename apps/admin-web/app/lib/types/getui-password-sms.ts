import type { AdminAppSummary, ConfigRevisionMeta } from "./core";

export interface GetuiGyAppCredentials {
  appId: string;
  appKey: string;
  appSecret: string;
  masterSecret: string;
}

export interface GetuiGyServiceConfig {
  enabled: boolean;
  endpoint: string;
  timeoutMs: number;
  apps: Record<string, GetuiGyAppCredentials>;
}

export interface GetuiGyServiceDraft {
  enabled: boolean;
  endpoint: string;
  timeoutMs: string;
  apps: Record<string, GetuiGyAppCredentials>;
}

export interface AdminGetuiGyServiceDocument {
  app: AdminAppSummary;
  configKey: string;
  config: GetuiGyServiceConfig;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export type GetuiGySensitiveCredentialField =
  | "appKey"
  | "appSecret"
  | "masterSecret";

export interface AdminGetuiGyCredentialRevealDocument {
  app: AdminAppSummary;
  configKey: string;
  zookAppId: string;
  field: GetuiGySensitiveCredentialField;
  value: string;
}

export interface PasswordEntry {
  key: string;
  desc: string;
  value: string;
  valueMd5?: string;
  updatedAt?: string;
}

export interface AdminPasswordDocument {
  app: AdminAppSummary;
  configKey: string;
  items: PasswordEntry[];
  updatedAt?: string;
}

export interface AdminPasswordRevealDocument {
  app: AdminAppSummary;
  configKey: string;
  key: string;
  desc: string;
  value: string;
  updatedAt?: string;
}

export interface AdminDeleteAppResult {
  deleted: true;
  appId: string;
}

export interface AdminSmsVerificationItem {
  id: string;
  appId: string;
  scene: "login" | "register" | "password-reset";
  channel: "sms";
  phoneMasked: string;
  phoneNa?: string;
  status:
    | "created"
    | "test_generated"
    | "provider_accepted"
    | "provider_failed"
    | "consumed"
    | "expired";
  isTest: boolean;
  provider: "tencent_sms";
  providerRequestId?: string;
  providerSerialNo?: string;
  providerMessage?: string;
  sentAt: string;
  expiresAt: string;
  consumedAt?: string;
  failedAt?: string;
  revealCount: number;
  lastRevealedAt?: string;
}

export interface AdminSmsVerificationListDocument {
  app: AdminAppSummary;
  items: AdminSmsVerificationItem[];
}

export interface AdminSmsVerificationRevealDocument {
  app: AdminAppSummary;
  item: AdminSmsVerificationItem;
  code: string;
  revealedAt: string;
}

export interface AdminTestAccountItem {
  id: string;
  appId: string;
  phoneNa: string;
  phone: string;
  phoneMasked: string;
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTestAccountDocument {
  app: AdminAppSummary;
  configKey: string;
  items: AdminTestAccountItem[];
  updatedAt?: string;
}

export interface AdminTestAccountRevealDocument {
  app: AdminAppSummary;
  configKey: string;
  item: AdminTestAccountItem;
  verifyCode: string;
  revealedAt: string;
}

export interface SmsServiceConfig {
  enabled: boolean;
  sdkAppId: string;
  templateId: string;
  signName: string;
  region: string;
}

export interface AdminSmsServiceDocument {
  app: AdminAppSummary;
  configKey: string;
  config: SmsServiceConfig;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface PasswordDraftItem {
  originalKey: string;
  key: string;
  desc: string;
  value: string;
  valueMd5?: string;
  updatedAt?: string;
}
