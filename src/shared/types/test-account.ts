import type { AdminAppSummary } from "./admin-core.ts";

export interface TestAccountRecord {
  id: string;
  appId: string;
  phoneNa: string;
  phone: string;
  label: string;
  enabled: boolean;
  verifyCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTestAccountItem {
  id: string;
  appId: string;
  phoneNa: string;
  phone: string;
  phoneMasked: string;
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTestAccountDocument {
  app: AdminAppSummary;
  configKey: string;
  items: AdminTestAccountItem[];
  updatedAt?: string;
}

export interface AdminTestAccountRevealDocument {
  app: AdminAppSummary;
  configKey: string;
  item: AdminTestAccountItem;
  verifyCode: string;
  revealedAt: string;
}
