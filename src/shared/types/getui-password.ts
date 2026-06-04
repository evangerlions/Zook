import type { ConfigRevisionMeta } from "./records.ts";
import type { AdminAppSummary } from "./admin-core.ts";

export interface GetuiGyAppCredentials {
  appId: string;
  appKey: string;
  appSecret: string;
  masterSecret: string;
}

export interface GetuiGyServiceConfig {
  enabled: boolean;
  endpoint: string;
  timeoutMs: number;
  apps: Record<string, GetuiGyAppCredentials>;
}

export interface AdminGetuiGyServiceDocument {
  app: AdminAppSummary;
  configKey: string;
  config: GetuiGyServiceConfig;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export type GetuiGySensitiveCredentialField =
  | "appKey"
  | "appSecret"
  | "masterSecret";

export interface AdminGetuiGyCredentialRevealDocument {
  app: AdminAppSummary;
  configKey: string;
  zookAppId: string;
  field: GetuiGySensitiveCredentialField;
  value: string;
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
