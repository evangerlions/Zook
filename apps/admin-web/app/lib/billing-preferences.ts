export type BillingEnvironment = "PRODUCTION" | "SANDBOX";
const ENVIRONMENT_KEY = "zook.admin.billing.environment";

export function loadBillingEnvironment(): BillingEnvironment {
  try {
    return typeof window !== "undefined"
      && window.localStorage.getItem(ENVIRONMENT_KEY) === "SANDBOX"
      ? "SANDBOX" : "PRODUCTION";
  } catch {
    return "PRODUCTION";
  }
}

export function saveBillingEnvironment(environment: BillingEnvironment): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(ENVIRONMENT_KEY, environment);
  } catch {
    // Storage restrictions must not prevent changing the current filter.
  }
}
