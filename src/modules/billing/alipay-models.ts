import type { AiNovelBillingMembershipInfo } from "../../shared/types.ts";

export type AlipayProductKey = "plus_monthly" | "plus_quarterly" | "plus_yearly" | "pro_monthly" | "pro_quarterly" | "pro_yearly";
export type AlipayPlatform = "android" | "web" | "windows";
export type AlipayDistribution = "china_android_store" | "direct_android" | "web" | "windows";
export interface AlipayCreateInput {
  productKey: AlipayProductKey;
  platform: AlipayPlatform;
  distribution: AlipayDistribution;
  idempotencyKey: string;
}
export interface AlipayOrder extends AlipayCreateInput {
  orderId: string;
  appId: "ai_novel";
  userId: string;
  provider: "alipay";
  merchantAppId: string;
  /** Empty means the application's default signing merchant; no explicit override. */
  sellerId: string;
  environment: "sandbox" | "production";
  status: "pending" | "paid" | "closed" | "failed";
  amountMinor: number;
  currency: "CNY";
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  providerTransactionId: string | null;
  membershipApplied: boolean;
  membershipExpiresAt: string | null;
  conflict: "provider_conflict" | null;
  accountDeletedAt: string | null;
}
export type AlipayPublicOrder = Pick<AlipayOrder, "orderId" | "provider" | "environment" | "productKey" | "status" | "amountMinor" | "currency" | "createdAt" | "expiresAt" | "paidAt" | "membershipApplied" | "conflict">;
export type AlipayPayment = { type: "app"; orderString: string } | { type: "page"; url: string };
export interface AlipayQueryResult { order: AlipayPublicOrder; syncStatus: "synchronized" | "pending"; membership: AiNovelBillingMembershipInfo }
export interface AlipayGateway {
  payment(order: AlipayOrder): Promise<AlipayPayment>;
  /** Must reject unverified responses. Normalized keys retain Alipay snake_case. */
  query(orderId: string): Promise<Record<string, unknown>>;
  verifyNotify(fields: Record<string, string>): Promise<boolean>;
}
export interface AlipayOptions {
  enabled?: boolean;
  appId?: string;
  /** Optional merchant override and additional settlement check. */
  sellerId?: string;
  notifyUrl?: string;
  returnUrl?: string;
  environment?: "sandbox" | "production";
  privateKeyPath?: string;
  publicKeyPath?: string;
  gateway?: AlipayGateway;
  now?: () => Date;
  /** Explicit minor-unit price catalog. Defaults are development placeholders only. */
  prices?: Record<AlipayProductKey, number>;
  pricesApproved?: boolean;
}
