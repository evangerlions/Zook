import { AsyncLocalStorage } from "node:async_hooks";
import { ApplicationError } from "../../shared/errors.ts";
import { getHeader } from "../../shared/utils.ts";
import type { HttpRequest } from "../../shared/types.ts";

export type BillingEnvironment = "sandbox" | "production";
export const BILLING_ENVIRONMENT_HEADER = "X-Billing-Environment";
// The container is stable; its value belongs to the async request/job, never a
// singleton service field. Concurrent users cannot change each other's source.
const scope = new AsyncLocalStorage<BillingEnvironment>();
export const billingEnvironment = (): BillingEnvironment => scope.getStore() ?? "production";
export function inBillingEnvironment<T>(environment: BillingEnvironment, work: () => T): T {
  return scope.run(environment, work);
}

export function billingSandboxAllowed(): boolean {
  return ["local", "dev", "development", "test"].includes(process.env.APP_ENV?.trim().toLowerCase() ?? "");
}
export function billingRequestEnvironment(request: HttpRequest, policy: { allowSandbox: boolean; defaultEnvironment?: BillingEnvironment } = { allowSandbox: billingSandboxAllowed() }): BillingEnvironment {
  const value = getHeader(request.headers, BILLING_ENVIRONMENT_HEADER.toLowerCase());
  if (value !== undefined && value !== "sandbox" && value !== "production")
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid billing environment.");
  if (value === "sandbox" && !policy.allowSandbox)
    throw new ApplicationError(403, "BILLING_ENVIRONMENT_FORBIDDEN", "Sandbox membership is not allowed on this server.");
  return value ?? (policy.allowSandbox ? policy.defaultEnvironment ?? "production" : "production");
}
