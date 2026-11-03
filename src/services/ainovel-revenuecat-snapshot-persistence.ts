import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { NormalizedRevenueCatSnapshot } from "../modules/billing/ainovel-revenuecat-normalizer.ts";
import { billingEnvironment } from "../modules/billing/billing-environment.ts";
import type { PersistedRevenueCatPurchase } from "../modules/billing/revenuecat-purchase-confirmation.ts";

/** Keep confirmation behind the existing account guard, transaction and snapshot writer. */
export function persistRevenueCatSnapshot(database: ApplicationDatabase, snapshot: NormalizedRevenueCatSnapshot,
  writeSnapshot: () => Promise<void>, transactionId?: string): Promise<PersistedRevenueCatPurchase | undefined> {
  return database.withExclusiveSession(async () => {
    const { appId, userId } = snapshot.membership;
    const user = await database.findAppUser(appId, userId);
    if (!user || user.status !== "ACTIVE") return undefined;
    await writeSnapshot();
    if (!transactionId) return undefined;
    const transactions = await database.listAiNovelBillingTransactions(appId, userId);
    const transaction = transactions.find(record => record.provider === "revenuecat" && record.providerTransactionId === transactionId &&
      record.isSandbox === (billingEnvironment() === "sandbox"));
    if (!transaction) return undefined;
    const membership = await database.findAiNovelBillingMembership(appId, userId);
    return { transaction, accessSnapshotCurrent: !!membership && membership.lastSyncedAt <= snapshot.membership.lastSyncedAt };
  });
}
