import type {
  AiNovelBillingTransactionRecord,
  AiNovelBillingWebhookEventRecord,
} from "./ainovel-billing.ts";

export type AiNovelBillingAdminProvider = "revenuecat";
export type AiNovelBillingAdminStatus =
  | "provider_paid"
  | "entitlement_active"
  | "expired"
  | "refunded"
  | "revoked"
  | "unknown";

export type AiNovelBillingAdminPaymentStatus = "provider_paid" | "refunded" | "unknown";
export type AiNovelBillingAdminEntitlementStatus =
  | "active"
  | "cancelled"
  | "grace_period"
  | "expired"
  | "revoked"
  | "unknown";

export interface AiNovelBillingAdminOrderFilter {
  appId: "ai_novel";
  userId?: string;
  paymentId?: string;
  providerTransactionId?: string;
  provider?: AiNovelBillingAdminProvider;
  platform?: "ios" | "android" | "macos";
  distribution?: "app_store" | "google_play";
  status?: AiNovelBillingAdminStatus;
  createdFrom?: string;
  createdTo?: string;
  after?: { observedAt: string; providerTransactionId: string; userId: string };
  limit: number;
}

export interface AiNovelBillingAdminEventFilter {
  appId: "ai_novel";
  userId: string;
  providerTransactionId: string;
  after?: { processedAt: string; eventId: string };
  limit: number;
}

export interface AiNovelBillingAdminEventPage {
  items: AiNovelBillingWebhookEventRecord[];
  nextCursor: string | null;
}

export interface AiNovelBillingAdminOrder {
  paymentId: string;
  appId: "ai_novel";
  userId: string;
  accountRegion: "UNKNOWN";
  platform: string | null;
  distribution: string;
  provider: "revenuecat";
  productKey: string;
  entitlementKey: string;
  tier: string;
  billingPeriod: "P1M" | "P3M" | "P1Y" | null;
  purchaseSource: string;
  catalogRevision: null;
  providerProductId: string;
  providerPackageId: null;
  providerEntitlementId: string;
  durationSeconds: number | null;
  amountMinor: number | null;
  currency: string | null;
  paymentStatus: AiNovelBillingAdminPaymentStatus;
  entitlementStatus: AiNovelBillingAdminEntitlementStatus;
  checkoutId: null;
  providerOrderId: null;
  providerTransactionId: string;
  environment: "PRODUCTION" | "SANDBOX" | null;
  paidAt: string | null;
  expiresAt: string | null;
  deletedAt: string | null;
  redactedAt: null;
  createdAt: string;
  updatedAt: string;
}

export interface AiNovelBillingAdminTransaction {
  transactionId: string;
  provider: "revenuecat";
  transactionKind: "purchase" | "renewal" | "refund" | "revoke";
  providerOrderId: null;
  providerTransactionId: string;
  relatedTransactionId: null;
  providerRefundId: null;
  refundAmountMinor: number | null;
  refundReason: null;
  status: AiNovelBillingAdminPaymentStatus;
  amountMinor: number | null;
  currency: string | null;
  occurredAt: string;
}

export interface AiNovelBillingAdminEvent {
  eventId: string;
  appId: "ai_novel";
  provider: "revenuecat";
  source: "webhook";
  eventType: string;
  providerEventId: string;
  affectedUserIds: string[];
  verificationResult: "verified";
  processingStatus: "processed" | "ignored";
  occurredAt: string | null;
  processedAt: string;
  accountDeletedAt: string | null;
}

export interface AiNovelBillingAdminOrderDetail {
  order: AiNovelBillingAdminOrder;
  currentMembership: {
    active: boolean;
    state: string;
    tier: string | null;
    planKey: string | null;
    expiresAt: string | null;
    autoRenew: boolean | null;
    source: string | null;
    lastSyncedAt: string | null;
    deletedAt: string | null;
  } | null;
  transactions: AiNovelBillingAdminTransaction[];
  entitlementGrants: Array<Record<string, unknown>>;
  events: AiNovelBillingAdminEvent[];
  eventsNextCursor: string | null;
}

export interface AiNovelBillingAdminOrderPage {
  items: AiNovelBillingAdminOrder[];
  nextCursor: string | null;
}

export interface AiNovelBillingAdminOrderDetailFilter {
  appId: "ai_novel";
  paymentId: string;
}
