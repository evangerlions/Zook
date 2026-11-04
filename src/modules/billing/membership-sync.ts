import { ApplicationError } from "../../shared/errors.ts";
import type { AiNovelBillingMembershipInfo } from "../../shared/types.ts";

export const PROVIDER_QUERY_TIMEOUT_MS = 20_000;
export type PurchaseReference = { kind: "alipay_order" | "store_transaction"; id: string };
export interface MembershipSyncInput {
  userId: string;
  requestId: string;
  provider: "alipay" | "revenuecat";
  reason?: "purchase" | "restore" | "app_start" | "retry";
  purchaseReference?: PurchaseReference;
  signal?: AbortSignal;
}
export interface TargetPurchase {
  reference: PurchaseReference;
  status: "pending" | "paid" | "closed" | "failed";
  entitlementStatus: "applied" | "blocked" | "not_applicable" | "pending";
}
export interface MembershipSyncResult {
  syncStatus: "complete" | "pending";
  membership: AiNovelBillingMembershipInfo;
  targetPurchase: TargetPurchase | null;
  pendingOrderCount: number;
  checkedAt: string;
}
export function parseMembershipSync(value: unknown): Omit<MembershipSyncInput, "userId" | "requestId" | "signal"> {
  const invalid = (): never => { throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid membership sync request."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(k => !["provider", "reason", "purchaseReference"].includes(k)) ||
      !["alipay", "revenuecat"].includes(String(body.provider)) ||
      (body.reason !== undefined && !["purchase", "restore", "app_start", "retry"].includes(String(body.reason)))) return invalid();
  const ref = body.purchaseReference as PurchaseReference | undefined;
  if (ref !== undefined && (!ref || typeof ref !== "object" || Array.isArray(ref) ||
      Object.keys(ref).some(k => !["kind", "id"].includes(k)) || typeof ref.id !== "string" || !ref.id.trim() || ref.id.length > 256 ||
      ref.kind !== (body.provider === "alipay" ? "alipay_order" : "store_transaction"))) return invalid();
  return { provider: body.provider as MembershipSyncInput["provider"], reason: body.reason as MembershipSyncInput["reason"], purchaseReference: ref };
}
