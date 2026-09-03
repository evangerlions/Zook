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

export interface AdminAiNovelModelSelectionDocument {
  app: AdminAppSummary;
  configKey: string;
  config: AiNovelModelSelectionConfig;
  availableChatModels: AiNovelChatModelOption[];
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}
