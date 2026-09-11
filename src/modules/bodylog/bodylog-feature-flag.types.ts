export interface FeatureFlagRecord {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureFlagDocument {
  key: string;
  enabled: boolean;
}

export interface FeatureFlagsConfig {
  [key: string]: boolean;
}
