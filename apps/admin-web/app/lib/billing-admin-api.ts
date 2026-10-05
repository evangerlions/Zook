import { adminPath, requestJson } from "./admin-api-client.ts";

export interface BillingApp { appId: string; appName: string; integrated: boolean }
export interface BillingRevenue { date: string; appId: string; source: string; currency: string; purchaseCount: number; grossMinor: number; refundMinor: number }
export interface BillingOverview { from: string; to: string; environment: string; rows: BillingRevenue[]; integratedApps: string[] }
export interface BillingMember { appId: string; userId: string; active: boolean; state: string; tier: string | null; planKey: string | null; expiresAt: string | null; autoRenew: boolean | null; source: string | null; lastSyncedAt: string; accountDeletedAt: string | null }
export interface BillingMemberPage { items: BillingMember[]; nextCursor: string | null }

function path(resource: string, query: Record<string, string | undefined>) {
  const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return adminPath(`/billing/${resource}?${params}`);
}

export const billingAdminApi = {
  apps: () => requestJson<BillingApp[]>(adminPath("/billing/apps")),
  overview: (query: { appId: string; environment: string; from?: string; to?: string }) => requestJson<BillingOverview>(path("overview", query)),
  memberships: (query: { appId: string; userId?: string; cursor?: string }) => requestJson<BillingMemberPage>(path("memberships", query)),
};
