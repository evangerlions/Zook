import type { AdminAppSummary, ConfigRevisionMeta } from "./core";

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
  catalog?: import("../../../../../src/shared/model-catalog-presentation.ts").ModelCatalogPresentation[];
  chat: {
    default: Array<{
      modelKey: string;
      weight: number;
    }>;
  };
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

export interface AdminAiNovelModelSelectionDocument {
  app: AdminAppSummary;
  configKey: string;
  config: AiNovelModelSelectionConfig;
  availableChatModels: AiNovelChatModelOption[];
  modelHealth: AiNovelModelHealth[];
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AiNovelModelPointPricing {
  modelKey: string;
  inputPointsPerMillionTokens?: number;
  outputPointsPerMillionTokens?: number;
  cachedInputPointsPerMillionTokens?: number;
  contextTiers?: Array<{
    abovePromptTokens: number;
    inputPointsPerMillionTokens: number;
    outputPointsPerMillionTokens: number;
  }>;
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

export interface AdminAiNovelModelPointPricingDocument {
  app: AdminAppSummary;
  configKey: string;
  config: AiNovelModelPointPricingConfig;
  availableModels: AiNovelPointPricingModelOption[];
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}
