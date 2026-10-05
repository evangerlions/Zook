import type { PublicConfigData as GeneratedPublicConfigData } from "../../generated/openapi/public-contracts.generated.ts";
import type { ConfigRevisionMeta, ClientLogUploadTaskStatus } from "./records.ts";
import type { AdminAppSummary } from "./admin-core.ts";

export interface AdminAiRoutingDocument {
  app: AdminAppSummary;
  configKey: string;
  rawJson: string;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AiNovelModelSelectionConfig {
  schemaVersion: 1;
  catalog?: import("../model-catalog-presentation.ts").ModelCatalogPresentation[];
  chat: {
    default: AiNovelWeightedModel[];
  };
}

export interface AiNovelWeightedModel {
  modelKey: string;
  weight: number;
}

export interface AiNovelChatModelOption {
  key: string;
  label: string;
  configuredAvailable: boolean;
}

export interface AiNovelModelHealth {
  modelKey: string;
  configuredWeight: number;
  effectiveWeight: number;
  actualHitRate: number;
  successRate?: number;
  healthScore: number;
  sampleSize: number;
  available: boolean;
  lastErrorAt?: string;
}

export interface AiNovelModelSelectionDocument {
  configKey: string;
  config: AiNovelModelSelectionConfig;
  availableChatModels: AiNovelChatModelOption[];
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminAiNovelModelSelectionDocument
  extends AiNovelModelSelectionDocument {
  app: AdminAppSummary;
  modelHealth: AiNovelModelHealth[];
}

export interface AiNovelModelPointPricing {
  modelKey: string;
  contextTiers?: Array<{ abovePromptTokens: number; inputPointsPerMillionTokens: number; outputPointsPerMillionTokens: number }>;
  cachedInputPointsPerMillionTokens?: number;
  inputPointsPerMillionTokens?: number;
  outputPointsPerMillionTokens?: number;
}

export interface AiNovelModelPointPricingConfig {
  schemaVersion: 1;
  models: AiNovelModelPointPricing[];
}

export interface AiNovelModelPointPricingReference {
  source: "openrouter" | "product";
  modelId?: string;
  inputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens?: number;
  match: "exact" | "approximate" | "unavailable";
  note?: string;
  url?: string;
}

export interface AiNovelPointPricingModelOption {
  key: string;
  label: string;
  kind: "chat" | "embedding";
  configuredAvailable: boolean;
  reference: AiNovelModelPointPricingReference;
}

export interface AiNovelModelPointPricingDocument {
  configKey: string;
  config: AiNovelModelPointPricingConfig;
  availableModels: AiNovelPointPricingModelOption[];
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminAiNovelModelPointPricingDocument
  extends AiNovelModelPointPricingDocument {
  app: AdminAppSummary;
}

export type PublicAppConfigDocument = GeneratedPublicConfigData;

export interface I18nSettings {
  defaultLocale: string;
  supportedLocales: string[];
  fallbackLocales: Record<string, string[]>;
}

export interface AppI18nConfigDocument {
  configKey: string;
  config: I18nSettings;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminAppI18nDocument extends AppI18nConfigDocument {
  app: AdminAppSummary;
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

export interface RemoteLogPullSettingsDocument {
  configKey: string;
  config: RemoteLogPullSettings;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminAppRemoteLogPullSettingsDocument extends RemoteLogPullSettingsDocument {
  app: AdminAppSummary;
}

export interface AdminRemoteLogPullTaskSummary {
  taskId: string;
  userId: string;
  did: string;
  keyId: string;
  status: ClientLogUploadTaskStatus;
  fromTsMs?: number;
  toTsMs?: number;
  maxLines?: number;
  maxBytes?: number;
  claimExpireAt?: string;
  uploadedAt?: string;
  uploadedFileName?: string;
  uploadedFileSizeBytes?: number;
  uploadedLineCount?: number;
  createdAt: string;
}

export interface AdminAppRemoteLogPullTaskListDocument {
  app: AdminAppSummary;
  items: AdminRemoteLogPullTaskSummary[];
}

export interface AdminRemoteLogPullTaskDocument {
  app: AdminAppSummary;
  item: AdminRemoteLogPullTaskSummary;
}

export interface AdminRemoteLogPullTaskFileDocument {
  appId: string;
  taskId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  lineCount?: number;
  content: string;
}
