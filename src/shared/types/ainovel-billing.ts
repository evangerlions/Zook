export type AiNovelBillingState = "free" | "active" | "cancelled" | "grace_period" | "expired";
export type AiNovelBillingSource = "app_store" | "play_store";
export type AiNovelBillingTier = "plus" | "pro";
export type AiNovelBillingPlatform = "ios" | "android" | "macos";

export interface AiNovelBillingMembershipInfo {
  active: boolean;
  state: AiNovelBillingState;
  tier: AiNovelBillingTier | null;
  planKey: string | null;
  expiresAt: string | null;
  autoRenew: boolean | null;
  source: AiNovelBillingSource | null;
  managementUrl: string | null;
}

export interface AiNovelBillingMembershipRecord extends AiNovelBillingMembershipInfo {
  appId: "ai_novel";
  userId: string;
  lastSyncedAt: string;
  accountDeletedAt: string | null;
}

export type AiNovelBillingTransactionStatus =
  | "provider_paid"
  | "entitlement_active"
  | "expired"
  | "refunded"
  | "revoked"
  | "unknown";

export interface AiNovelBillingTransactionRecord {
  appId: "ai_novel";
  userId: string;
  provider: "revenuecat";
  providerTransactionId: string;
  productId: string;
  productKey: string;
  source: AiNovelBillingSource;
  platform: AiNovelBillingPlatform | null;
  status: AiNovelBillingTransactionStatus;
  purchasedAt: string | null;
  originalPurchaseDate: string | null;
  expiresAt: string | null;
  refundedAt: string | null;
  autoRenew: boolean | null;
  isSandbox: boolean | null;
  amountMinor: number | null;
  refundAmountMinor: number | null;
  currency: string | null;
  observedAt: string;
  accountDeletedAt: string | null;
}

export interface AiNovelBillingWebhookEventRecord {
  appId: "ai_novel";
  eventId: string;
  eventType: string;
  userId: string | null;
  affectedUserIds: string[];
  productId: string | null;
  providerTransactionId: string | null;
  status: "processed" | "ignored";
  occurredAt: string | null;
  processedAt: string;
  accountDeletedAt: string | null;
}
