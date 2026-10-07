import type { AdminAppSummary, ConfigRevisionMeta } from "./admin-core.ts";

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
  /** Optional per-locale copy shown in the client update dialog. */
  messageI18n?: Record<string, string>;
}

export interface ReleaseUpdateExperiment {
  id: string;
  enabled: boolean;
  rolloutPercent: number;
  artifact: ReleaseUpdateArtifact;
}

export interface ReleaseUpdateReminderPolicy {
  /** 0 means unlimited prompts while the target is still applicable. */
  maxCount: number;
  /** Minimum delay between two prompts for the same installed build. */
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

export interface ReleaseUpdateProductConfig {
  targets: ReleaseUpdateTarget[];
}

/** Global release catalog. Public responses never expose this whole object. */
export interface ReleaseUpdateConfig {
  schemaVersion: 1;
  products: Record<string, ReleaseUpdateProductConfig>;
}

/** Product-filtered update data consumed by a client. */
export interface PublicReleaseUpdateConfig {
  schemaVersion: 1;
  targets: ReleaseUpdateTarget[];
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

export interface PublicReleaseUpdateDocument {
  appId: string;
  config: PublicReleaseUpdateConfig;
  updatedAt?: string;
}
