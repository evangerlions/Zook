import type { TencentSesRegion } from "./enums.ts";
import type { ConfigRevisionMeta } from "./records.ts";
import type { AdminAppSummary } from "./admin-core.ts";

export type TencentSesEmailEvent =
  | "delivered"
  | "dropped"
  | "bounce"
  | "open"
  | "click"
  | "spamreport"
  | "unsubscribe"
  | "deferred";

export interface EmailServiceTemplateConfig {
  locale: string;
  templateId: number;
  name: string;
  subject: string;
}

export interface EmailSenderConfig {
  id: string;
  address: string;
}

export interface EmailServiceRegionConfig {
  region: TencentSesRegion;
  sender?: EmailSenderConfig | null;
  templates: EmailServiceTemplateConfig[];
}

export interface EmailServiceConfig {
  enabled: boolean;
  regions: EmailServiceRegionConfig[];
}

export interface AdminEmailServiceDocument {
  app: AdminAppSummary;
  configKey: string;
  config: EmailServiceConfig;
  resolvedRegion: TencentSesRegion;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminEmailTestSendCommand {
  recipientEmail: string;
  region: TencentSesRegion;
  templateId: number;
  appName: string;
  code: string;
  expireMinutes: number;
}

export interface AdminEmailTestSendDocument {
  executedAt: string;
  cooldownSeconds: number;
  recipientEmail: string;
  clientRegion: TencentSesRegion;
  resolvedRegion: TencentSesRegion;
  sender: {
    id: string;
    address: string;
    region: TencentSesRegion;
  };
  template: {
    locale: string;
    templateId: number;
    name: string;
    subject: string;
  };
  templateData: {
    appName: string;
    expireMinutes: number;
    code: string;
  };
  provider: "tencent_ses";
  providerRequestId?: string;
  providerMessageId?: string;
  debug?: {
    request: {
      endpoint: string;
      method: "POST";
      clientRegion: TencentSesRegion;
      resolvedRegion: TencentSesRegion;
      headers: Record<string, string>;
      credentials: {
        secretIdMasked: string;
        secretKeyMasked: string;
      };
      body: Record<string, unknown>;
    };
    response?: {
      statusCode: number;
      ok: boolean;
      body: unknown;
      requestId?: string;
      messageId?: string;
      errorCode?: string;
      errorMessage?: string;
    };
  };
}

export interface EmailDeliveryEventRecord {
  id: string;
  provider: "tencent_ses";
  event: TencentSesEmailEvent;
  eventId?: number;
  email: string;
  link?: string;
  bulkId?: string;
  timestamp?: number;
  reason?: string;
  bounceType?: "soft_bounce" | "hard_bounce" | string;
  username?: string;
  from?: string;
  fromDomain?: string;
  templateId?: number;
  subject?: string;
  messageId?: string;
  userAgent?: string;
  sentTimestamp?: number;
  rawPayload: Record<string, unknown>;
  occurredAt: string;
  receivedAt: string;
}

export interface TencentSesEmailCallbackAcceptedDocument {
  accepted: true;
  id: string;
  event: TencentSesEmailEvent;
}

export interface AdminEmailDeliveryEventItem {
  id: string;
  provider: "tencent_ses";
  event: TencentSesEmailEvent;
  eventId?: number;
  email: string;
  link?: string;
  bulkId?: string;
  timestamp?: number;
  reason?: string;
  bounceType?: string;
  username?: string;
  from?: string;
  fromDomain?: string;
  templateId?: number;
  subject?: string;
  messageId?: string;
  userAgent?: string;
  sentTimestamp?: number;
  occurredAt: string;
  receivedAt: string;
}

export interface AdminEmailDeliveryEventListDocument {
  app: AdminAppSummary;
  items: AdminEmailDeliveryEventItem[];
}
