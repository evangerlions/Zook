export type RevenueCatResource = Record<string, unknown>;
export interface RevenueCatSubscriptionEvidence {
  subscription: RevenueCatResource;
  product: RevenueCatResource;
  entitlements: RevenueCatResource[];
  transactions: RevenueCatResource[];
}
export interface RevenueCatSnapshot {
  subscriptions: RevenueCatSubscriptionEvidence[];
  activeEntitlements: RevenueCatResource[];
  observedAt: string;
}
export class RevenueCatApiError extends Error {
  constructor(readonly reason: "not_configured" | "request_failed" | "invalid_response",
    readonly diagnostics: { httpStatus?: number; failureKind?: string } = {}) {
    super("RevenueCat customer lookup failed.");
    this.name = "RevenueCatApiError";
  }
}
export function isObject(value: unknown): value is RevenueCatResource {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
