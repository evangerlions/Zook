import { isObject } from "../../services/ainovel-revenuecat-types.ts";

/** A permissive flag for likely or already-paid renewal; preserve the provider state separately. */
export function revenueCatAutoRenew(subscription: Record<string, unknown>): boolean | null {
  const status = subscription.auto_renewal_status;
  switch (status) {
    case "will_renew":
    case "will_change_product":
    case "requires_price_increase_consent":
      return true;
    case "will_not_renew":
    case "will_pause":
      return false;
    case "has_already_renewed": {
      const next = isObject(subscription.pending_changes) ? subscription.pending_changes.auto_renewal_status : null;
      if (next === "will_not_renew" || next === "will_pause") return false;
      return true;
    }
    default:
      return null;
  }
}

/** Only an explicit cancellation should be presented as cancelled. */
export function revenueCatIsCancelled(subscription: Record<string, unknown>): boolean {
  if (subscription.auto_renewal_status === "will_not_renew") return true;
  return subscription.auto_renewal_status === "has_already_renewed" &&
    isObject(subscription.pending_changes) && subscription.pending_changes.auto_renewal_status === "will_not_renew";
}
