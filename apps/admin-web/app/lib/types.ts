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

export interface RemoteLogPullSettings {
  enabled: boolean;
  minPullIntervalSeconds: number;
  claimTtlSeconds: number;
  taskDefaults: {
    lookbackMinutes: number;
    maxLines: number;
    maxBytes: number;
  };
}

export interface AdminRemoteLogPullSettingsDocument {
  app: AdminAppSummary;
  configKey: string;
  config: RemoteLogPullSettings;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminRemoteLogPullTaskSummary {
  taskId: string;
  userId: string;
  did: string;
  keyId: string;
  status: "PENDING" | "CLAIMED" | "COMPLETED" | "CANCELLED";
  fromTsMs?: number;
  toTsMs?: number;
  maxLines?: number;
  maxBytes?: number;
  claimExpireAt?: string;
  uploadedAt?: string;
  createdAt: string;
}

export interface AdminRemoteLogPullTaskListDocument {
  app: AdminAppSummary;
  items: AdminRemoteLogPullTaskSummary[];
}

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

export type LlmMetricsRange = "24h" | "7d" | "30d";
export type LlmRoutingStrategy = "auto" | "fixed";
export type LlmModelKind = "chat" | "embedding";

export interface LlmProviderConfig {
  key: string;
  label: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export interface LlmModelRouteConfig {
  provider: string;
  providerModel: string;
  enabled: boolean;
  weight: number;
}

export interface LlmModelConfig {
  key: string;
  label: string;
  kind: LlmModelKind;
  strategy: LlmRoutingStrategy;
  routes: LlmModelRouteConfig[];
}

export interface LlmServiceConfig {
  enabled: boolean;
  defaultModelKey: string;
  providers: LlmProviderConfig[];
  models: LlmModelConfig[];
}

export interface LlmRouteRuntimeStatus {
  provider: string;
  providerModel: string;
  enabled: boolean;
  weight: number;
  totalCalls: number;
  sampleSize: number;
  successRate: number;
  healthScore: number;
  effectiveProbability?: number;
  lastErrorAt?: string;
}

export interface LlmModelRuntimeStatus {
  key: string;
  kind: LlmModelKind;
  strategy: LlmRoutingStrategy;
  routes: LlmRouteRuntimeStatus[];
}

export interface LlmRuntimeSnapshot {
  generatedAt: string;
  models: LlmModelRuntimeStatus[];
}

export interface AdminLlmServiceDocument {
  app: AdminAppSummary;
  configKey: string;
  config: LlmServiceConfig;
  runtime: LlmRuntimeSnapshot;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface LlmMetricsSummary {
  requestCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgFirstByteLatencyMs: number;
  avgTotalLatencyMs: number;
  p95FirstByteLatencyMs: number;
  p95TotalLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmHourlySeriesItem extends LlmMetricsSummary {
  hour: string;
}

export interface LlmModelMetricsGroup {
  modelKey: string;
  label: string;
  summary: LlmMetricsSummary;
  items: LlmHourlySeriesItem[];
}

export interface LlmRouteMetricsGroup {
  modelKey: string;
  provider: string;
  providerModel: string;
  summary: LlmMetricsSummary;
  items: LlmHourlySeriesItem[];
}

export interface AdminLlmMetricsDocument {
  timezone: string;
  range: LlmMetricsRange;
  summary: LlmMetricsSummary;
  models: LlmModelMetricsGroup[];
}

export interface AdminLlmModelMetricsDocument {
  timezone: string;
  range: LlmMetricsRange;
  modelKey: string;
  label: string;
  summary: LlmMetricsSummary;
  routes: LlmRouteMetricsGroup[];
}

export interface AdminLlmSmokeTestSummary {
  totalCount: number;
  attemptedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  successRate: number;
}

export interface AdminLlmSmokeTestItem {
  modelKey: string;
  modelLabel: string;
  modelKind: LlmModelKind;
  provider: string;
  providerLabel: string;
  providerModel: string;
  configured: boolean;
  status: "success" | "failed" | "skipped";
  latencyMs?: number;
  message: string;
  responsePreview?: string;
  details: {
    request?: Record<string, unknown>;
    response?: Record<string, unknown>;
    error?: Record<string, unknown>;
    skip?: Record<string, unknown>;
  };
}

export interface AdminLlmSmokeTestDocument {
  executedAt: string;
  cooldownSeconds: number;
  summary: AdminLlmSmokeTestSummary;
  items: AdminLlmSmokeTestItem[];
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

export interface PasswordDraftItem {
  originalKey: string;
  key: string;
  desc: string;
  value: string;
  valueMd5?: string;
  updatedAt?: string;
}

export interface LlmProviderDraft {
  key: string;
  label: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  timeoutMs: string;
}

export interface LlmRouteDraft {
  provider: string;
  providerModel: string;
  enabled: boolean;
  weight: string;
}

export interface LlmModelDraft {
  key: string;
  label: string;
  kind: LlmModelKind;
  strategy: LlmRoutingStrategy;
  routes: LlmRouteDraft[];
}

export interface LlmConfigDraft {
  enabled: boolean;
  defaultModelKey: string;
  providers: LlmProviderDraft[];
  models: LlmModelDraft[];
}
