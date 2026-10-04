import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { NormalizedRevenueCatSnapshot } from "../modules/billing/ainovel-revenuecat-normalizer.ts";
import type { AiNovelBillingMembershipInfo } from "../shared/types.ts";
import type { AiNovelBillingSyncResult } from "./ainovel-billing.service.ts";
import { RevenueCatApiError } from "./ainovel-revenuecat-client.ts";

export interface BillingSyncInput {
  userId: string;
  requestId: string;
  reason?: "purchase" | "restore" | "app_start" | "retry";
  signal?: AbortSignal;
}

interface BillingSyncDependencies {
  logger: StructuredLogger;
  fetchSnapshot: () => Promise<NormalizedRevenueCatSnapshot>;
  persistSnapshot: (snapshot: NormalizedRevenueCatSnapshot) => Promise<void>;
  getMembership: () => Promise<AiNovelBillingMembershipInfo>;
}

/** One request owns its timing and diagnostics; persistence stays canonical. */
export async function runBillingSync(input: BillingSyncInput,
  dependencies: BillingSyncDependencies): Promise<AiNovelBillingSyncResult> {
  const { logger, fetchSnapshot, persistSnapshot, getMembership } = dependencies;
  const context = { requestId: input.requestId, appId: "ai_novel",
    userId: input.userId, provider: "revenuecat", reason: input.reason ?? "unspecified" };
  const startedAt = performance.now();
  const durationMs = () => Math.round(performance.now() - startedAt);
  logger.info("ainovel billing sync started", context);
  let snapshot: NormalizedRevenueCatSnapshot;
  try {
    snapshot = await fetchSnapshot();
  } catch (error) {
    const membership = await getMembership();
    logger.warn("ainovel billing sync pending", {
      ...context, status: "pending", durationMs: durationMs(),
      failureReason: error instanceof RevenueCatApiError ? error.reason : "normalization_failed",
      ...(error instanceof RevenueCatApiError ? error.diagnostics : {}),
      membershipState: membership.state,
    });
    return { syncStatus: "pending", membership };
  }
  if (snapshot.hasActiveUnverifiedEnvironmentEntitlement) {
    const membership = await getMembership();
    logger.warn("ainovel billing sync deferred unverified store environment", {
      ...context, status: "pending", durationMs: durationMs(),
      failureReason: "unverified_store_environment", membershipState: membership.state,
    });
    return { syncStatus: "pending", membership };
  }
  try {
    logger.info("ainovel billing persistence started", {
      ...context, transactionCount: snapshot.transactions.length,
    });
    await persistSnapshot(snapshot);
    for (const transaction of snapshot.transactions) {
      logger.info("ainovel billing transaction observed", {
        ...context, providerTransactionId: transaction.providerTransactionId,
        productKey: transaction.productKey, transactionStatus: transaction.status,
        isSandbox: transaction.isSandbox,
      });
    }
    const membership = await getMembership();
    logger.info("ainovel billing sync completed", {
      ...context, status: "synchronized", durationMs: durationMs(),
      productKey: membership.planKey ?? undefined, membershipState: membership.state,
      transactionCount: snapshot.transactions.length,
    });
    return { syncStatus: "synchronized", membership };
  } catch (error) {
    logger.error("ainovel billing persistence failed", {
      ...context, status: "failed", failureReason: "database_error", durationMs: durationMs(),
    });
    throw error;
  }
}
