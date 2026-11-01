
export type AlipayProductKey = "plus_monthly" | "plus_quarterly" | "plus_yearly" | "pro_monthly" | "pro_quarterly" | "pro_yearly";
export type AlipayPlatform = "android" | "web" | "windows";
export type AlipayDistribution = "china_android_store" | "direct_android" | "web" | "windows";
export interface AlipayCreateInput {
  market?: import("./billing-market.ts").BillingMarket | null;
  productKey: AlipayProductKey;
  platform: AlipayPlatform;
  distribution: AlipayDistribution;
  idempotencyKey: string;
  checkoutMode?: "mobile_web" | "desktop_web" | "qr";
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
  membershipStartsAt?: string | null;
  conflict: "provider_conflict" | null;
  accountDeletedAt: string | null;
  /** Internal scheduling hint; not part of the public order contract. */
  lastRecoveryAt?: string;
}
export type AlipayPublicOrder = Pick<AlipayOrder, "orderId" | "provider" | "environment" | "productKey" | "status" | "amountMinor" | "currency" | "createdAt" | "expiresAt" | "paidAt" | "membershipApplied" | "conflict">;
export type AlipayPayment = { type: "app"; orderString: string } | { type: "page"; url: string } | { type: "qr"; qrCode: string };
export interface AlipayGateway {
  payment(order: AlipayOrder): Promise<AlipayPayment>;
  /** Must reject unverified responses. Normalized keys retain Alipay snake_case. */
  query(orderId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  verifyNotify(fields: Record<string, string>): Promise<boolean>;
}
export interface AlipayOptions {
  /** Testable per-query deadline; production defaults to 20 seconds. */
  queryTimeoutMs?: number;
  allowSandbox?: boolean;
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
