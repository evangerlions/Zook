import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { HttpRequest } from "../../shared/types.ts";
import { ApplicationError } from "../../shared/errors.ts";
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

export function appleSandboxUserIds(config: Record<string, unknown>): string[] {
  const billing = config.billing as { revenueCat?: { sandboxAppUserIds?: unknown } } | undefined;
  const ids = billing?.revenueCat?.sandboxAppUserIds;
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== "string" ||
      !id.trim() || id.trim() !== id || id.length > 256) || new Set(ids).size !== ids.length) {
    throw new ApplicationError(400, "ADMIN_CONFIG_INVALID_JSON", "billing.revenueCat.sandboxAppUserIds must contain at most 100 distinct non-empty app user IDs.");
  }
  return ids;
}

/** Only the public projection omits the private operational admission list. */
export function publicAppleSandboxConfig(config: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(config);
  const billing = result.billing as { revenueCat?: Record<string, unknown> } | undefined;
  if (billing?.revenueCat) delete billing.revenueCat.sandboxAppUserIds;
  return result;
}

export class AppleSandboxAccess {
  constructor(private readonly database: ApplicationDatabase, private readonly deployment: string,
    private readonly readUserIds: () => Promise<readonly string[]>, private readonly now: () => Date) {}

  async allows(userId: string): Promise<boolean> {
    return online(this.deployment) && (await this.readUserIds()).includes(userId);
  }

  async allowsEvent(event: ParsedWebhookEvent): Promise<boolean> {
    if (!online(this.deployment) || !appleStore(event.store)) return false;
    const users = event.type === "TRANSFER" ? [...event.transferredFrom, ...event.transferredTo] : [event.appUserId];
    const ids = await this.readUserIds();
    return users.some(id => ids.includes(id));
  }

  async environment(userId: string): Promise<BillingEnvironment> {
    if (!await this.allows(userId)) return "production";
    const formal = await inBillingEnvironment("production", () => this.database.findAiNovelBillingMembership("ai_novel", userId));
    const active = formal?.active && !formal.accountDeletedAt &&
      (formal.expiresAt === null || Date.parse(formal.expiresAt) > this.now().getTime());
    return active ? "production" : "sandbox";
  }
}
