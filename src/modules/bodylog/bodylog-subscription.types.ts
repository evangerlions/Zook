// ===== 订阅相关类型 =====

export type SubscriptionTier = "free" | "plus" | "pro";

export interface UserSubscriptionRecord {
  id: string;
  appId: string;
  userId: string;
  tier: SubscriptionTier;
  startedAt: string;
  expiresAt: string;
  originalTransactionId: string | null;
  autoRenew: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionEventType =
  | "created"
  | "renewed"
  | "cancelled"
  | "expired"
  | "upgraded"
  | "reward_granted";

export interface SubscriptionEventRecord {
  id: string;
  subscriptionId: string;
  eventType: SubscriptionEventType;
  tier: SubscriptionTier;
  metadata: Record<string, any>;
  occurredAt: string;
}
