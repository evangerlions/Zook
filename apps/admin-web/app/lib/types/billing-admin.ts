export type BillingOrderStatus =
  | "pending"
  | "closed"
  | "failed"
  | "provider_paid"
  | "entitlement_active"
  | "expired"
  | "refunded"
  | "revoked"
  | "unknown";

export type BillingPaymentStatus = "provider_paid" | "refunded" | "unknown" | "pending" | "closed" | "failed";
export type BillingEntitlementStatus =
  | "active"
  | "cancelled"
  | "grace_period"
  | "expired"
  | "revoked"
  | "unknown";

export interface AdminBillingOrder {
  paymentId: string;
  appId: string;
  userId: string;
  accountRegion: "UNKNOWN" | "CN";
  platform: "ios" | "android" | "macos" | "web" | "windows" | null;
  distribution: "app_store" | "google_play" | "china_android_store" | "direct_android" | "web" | "windows";
  provider: "revenuecat" | "alipay";
  productKey: string;
  entitlementKey: string;
  tier: string;
  billingPeriod: "P1M" | "P3M" | "P1Y" | null;
  purchaseSource: string;
  amountMinor: number | null;
  currency: string | null;
  paymentStatus: BillingPaymentStatus;
  entitlementStatus: BillingEntitlementStatus;
  providerProductId: string;
  providerTransactionId: string;
  providerOrderId?: string | null;
  checkoutId?: string | null;
  environment: "PRODUCTION" | "SANDBOX" | null;
  paidAt: string | null;
  expiresAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBillingOrderPage {
  items: AdminBillingOrder[];
  nextCursor: string | null;
}

export interface AdminBillingEvent {
  eventId: string;
  providerEventId: string;
  eventType: string;
  affectedUserIds: string[];
  processingStatus: "processed" | "ignored";
  verificationResult: "verified" | "not_applicable";
  occurredAt: string | null;
  processedAt: string;
  accountDeletedAt: string | null;
}

export interface AdminBillingOrderDetail {
  order: AdminBillingOrder;
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
  transactions: Array<{
    transactionId: string;
    transactionKind: "purchase" | "renewal" | "refund" | "revoke";
    providerTransactionId: string;
  status: BillingPaymentStatus;
    amountMinor: number | null;
    refundAmountMinor: number | null;
    currency: string | null;
  occurredAt: string;
  }>;
  entitlementGrants: unknown[];
  events: AdminBillingEvent[];
  eventsNextCursor: string | null;
}
