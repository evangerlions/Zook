/** Common admin read models. Product billing write models remain app-owned. */
export interface BillingSummaryFilter {
  from: string;
  to: string;
  sandbox: boolean;
}

export interface BillingRevenueRow {
  /** UTC calendar date, YYYY-MM-DD. Purchases and refunds use their own event dates. */
  date: string;
  appId: string;
  source: string;
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
