import type { AdminAppSummary, ConfigRevisionMeta } from "./core";

export type ReleaseUpdatePlatform = "android" | "ios" | "ohos" | "windows" | "web";
export type ReleaseUpdateDelivery = "download" | "store";

export interface ReleaseVersion {
  version: string;
  buildNumber: number;
}

export interface ReleaseUpdateArtifact extends ReleaseVersion {
  packageName?: string;
  fileName?: string;
  downloadUrl?: string;
  storeUrl?: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface ReleaseUpdateExperiment {
  id: string;
  enabled: boolean;
  rolloutPercent: number;
  artifact: ReleaseUpdateArtifact;
}

export interface ReleaseUpdateReminderPolicy {
  maxCount: number;
  intervalSeconds: number;
}

export interface ReleaseUpdateTarget {
  id: string;
  platform: ReleaseUpdatePlatform;
  channel: string;
  delivery: ReleaseUpdateDelivery;
  enabled: boolean;
  mandatory: boolean;
  latest: ReleaseUpdateArtifact;
  minimumSupported?: ReleaseVersion;
  reminder: ReleaseUpdateReminderPolicy;
  experiments: ReleaseUpdateExperiment[];
}

export interface ReleaseUpdateConfig {
  schemaVersion: 1;
  products: Record<string, { targets: ReleaseUpdateTarget[] }>;
}

export interface AdminReleaseUpdateDocument {
  app: AdminAppSummary;
  configKey: string;
  config: ReleaseUpdateConfig;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}
