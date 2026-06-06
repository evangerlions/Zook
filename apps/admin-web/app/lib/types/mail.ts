import type { AdminAppSummary, ConfigRevisionMeta } from "./core";

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
  region: "ap-guangzhou" | "ap-hongkong";
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
  resolvedRegion: "ap-guangzhou" | "ap-hongkong";
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminEmailTestSendCommand {
  recipientEmail: string;
  region: "ap-guangzhou" | "ap-hongkong";
  templateId: number;
  appName: string;
  code: string;
  expireMinutes: number;
}

export interface AdminEmailTestSendDocument {
  executedAt: string;
  cooldownSeconds: number;
  recipientEmail: string;
  clientRegion: "ap-guangzhou" | "ap-hongkong";
  resolvedRegion: "ap-guangzhou" | "ap-hongkong";
  sender: {
    id: string;
    address: string;
    region: "ap-guangzhou" | "ap-hongkong";
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
    request: Record<string, unknown>;
    response?: Record<string, unknown>;
  };
}

export interface MailTemplateDraft {
  locale: string;
  templateId: string;
  name: string;
  subject: string;
}

export interface MailRegionDraft {
  region: "ap-guangzhou" | "ap-hongkong";
  sender: EmailSenderConfig | null;
  templates: MailTemplateDraft[];
}

export interface MailConfigDraft {
  enabled: boolean;
  regions: MailRegionDraft[];
}

export interface MailTestDraft {
  recipientEmail: string;
  region: "ap-guangzhou" | "ap-hongkong";
  templateId: string;
  appName: string;
  code: string;
  expireMinutes: number | string;
}
