import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { HttpRequest } from "../../shared/types.ts";
import { getHeader } from "../../shared/utils.ts";
import { inBillingEnvironment, type BillingEnvironment } from "./billing-environment.ts";
import type { RevenueCatSnapshot } from "../../services/ainovel-revenuecat-types.ts";
import type { ParsedWebhookEvent } from "./revenuecat-webhook-event.ts";

const online = (deployment: string) => ["online", "production"].includes(deployment);
const appleStore = (store: unknown) => typeof store === "string" && ["app_store", "mac_app_store"].includes(store.toLowerCase());

export function appleSandboxPayload(payload: RevenueCatSnapshot): RevenueCatSnapshot {
  return { ...payload, subscriptions: payload.subscriptions.filter(item => appleStore(item.subscription.store)) };
}

/** Channel selection is not authorization: the server-owned user allowlist is. */
export function isAppleSandboxCandidate(request: HttpRequest, deployment: string): boolean {
  if (!online(deployment) || !["ios", "macos"].includes(getHeader(request.headers, "x-platform") ?? "") ||
      !getHeader(request.headers, "authorization")?.startsWith("Bearer ")) return false;
  return (request.path.startsWith("/api/v1/ai_novel/") &&
    !request.path.startsWith("/api/v1/ai_novel/public/") && !request.path.includes("/webhooks/")) ||
    (request.path === "/api/v1/users/me" && getHeader(request.headers, "x-app-id") === "ai_novel");
}

export class AppleSandboxAccess {
  constructor(private readonly database: ApplicationDatabase, private readonly deployment: string,
    private readonly isTestAccount: (userId: string) => Promise<boolean>, private readonly now: () => Date) {}

  async allows(userId: string): Promise<boolean> {
    return online(this.deployment) && this.isTestAccount(userId);
  }

  async allowsEvent(event: ParsedWebhookEvent): Promise<boolean> {
    if (!online(this.deployment) || !appleStore(event.store)) return false;
    const users = event.type === "TRANSFER" ? [...event.transferredFrom, ...event.transferredTo] : [event.appUserId];
    return (await Promise.all(users.map(id => this.allows(id)))).some(Boolean);
  }

  async environment(userId: string): Promise<BillingEnvironment> {
    if (!await this.allows(userId)) return "production";
    const formal = await inBillingEnvironment("production", () => this.database.findAiNovelBillingMembership("ai_novel", userId));
    const active = formal?.active && !formal.accountDeletedAt &&
      (formal.expiresAt === null || Date.parse(formal.expiresAt) > this.now().getTime());
    return active ? "production" : "sandbox";
  }
}
