/** Common admin read models. Product billing write models remain app-owned. */
export type BillingRevenueDimension = "appId" | "productKey" | "source" | "market";

export interface BillingSummaryFilter {
  groupBy?: BillingRevenueDimension[];
  from: string;
  to: string;
  sandbox: boolean;
}

export interface BillingRevenueRow {
  /** UTC calendar date, YYYY-MM-DD. Purchases and refunds use their own event dates. */
  date: string;
  appId: string | null;
  productKey: string | null;
  source: string | null;
  market: string | null;
  currency: string;
  purchaseCount: number;
  grossMinor: number;
  refundMinor: number;
}

export interface BillingMembershipFilter {
  expiry?: "expired" | "not_expired";
  now?: string;
  userId?: string;
  after?: string;
  limit: number;
}
