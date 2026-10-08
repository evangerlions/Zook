import { createHash } from "node:crypto";
import type { BodyLogSubscriptionStore } from "../../infrastructure/bodylog-store-ports.ts";
import { SubscriptionEventType } from "../../services/subscription.service.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import type { BodyLogPurchaseProof } from "./bodylog-store-purchase-verifier.ts";
import { BodyLogStorePurchaseVerifier } from "./bodylog-store-purchase-verifier.ts";

function stableId(prefix: string, key: string): string {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

export class BodyLogPurchaseVerificationService {
  constructor(
    private readonly store: BodyLogSubscriptionStore,
    private readonly verifier: BodyLogStorePurchaseVerifier,
  ) {}

  async verify(userId: string, proof: BodyLogPurchaseProof) {
    const purchase = await this.verifier.verify(proof);
    const now = new Date().toISOString();
    const subscriptionId = stableId("bodylog_iap", `${purchase.platform}:${purchase.originalTransactionId}`);
    const prior = await this.store.findActiveUserSubscription(BODYLOG_APP_ID, userId);
    const record = {
      id: subscriptionId,
      appId: BODYLOG_APP_ID,
      userId,
      tier: purchase.tier,
      startedAt: purchase.startedAt,
      expiresAt: purchase.expiresAt,
      originalTransactionId: `${purchase.platform}:${purchase.originalTransactionId}`,
      autoRenew: purchase.autoRenew,
      createdAt: now,
      updatedAt: now,
    } as const;

    await this.store.upsertUserSubscription(record);
    const eventId = stableId("bodylog_iap_event", `${purchase.platform}:${purchase.transactionId}:${purchase.expiresAt}`);
    await this.store.insertSubscriptionEvent({
      id: eventId,
      subscriptionId,
      eventType: prior ? SubscriptionEventType.RENEWED : SubscriptionEventType.CREATED,
      tier: purchase.tier,
      metadata: {
        provider: purchase.platform === "ios" ? "app_store" : "google_play",
        product_id: purchase.productId,
        transaction_id_hash: createHash("sha256").update(purchase.transactionId).digest("hex"),
        expires_at: purchase.expiresAt,
      },
      occurredAt: now,
    });

    return {
      verified: true,
      tier: purchase.expiresAt > now ? purchase.tier : "free",
      expiresAt: purchase.expiresAt,
      autoRenew: purchase.autoRenew,
    };
  }
}
