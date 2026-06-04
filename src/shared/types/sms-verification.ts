import type { ConfigRevisionMeta } from "./records.ts";
import type { AdminAppSummary } from "./admin-core.ts";

export type SmsVerificationScene = "login" | "register" | "password-reset";
export type SmsVerificationChannel = "sms";
export type SmsVerificationLifecycle =
  | "created"
  | "test_generated"
  | "provider_accepted"
  | "provider_failed"
  | "consumed"
  | "expired";

export interface SmsVerificationRecord {
  id: string;
  appId: string;
  scene: SmsVerificationScene;
  channel: SmsVerificationChannel;
  phoneMasked: string;
  phoneHash: string;
  phoneNa?: string;
  codePlaintext: string;
  status: SmsVerificationLifecycle;
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
  createdAt: string;
  updatedAt: string;
}

export interface AdminSmsVerificationItem {
  id: string;
  appId: string;
  scene: SmsVerificationScene;
  channel: SmsVerificationChannel;
  phoneMasked: string;
  phoneNa?: string;
  status: SmsVerificationLifecycle;
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
