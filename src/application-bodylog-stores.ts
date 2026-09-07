import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import { PostgresDatabase } from "./infrastructure/database/postgres/postgres-database.ts";
import type { BodyLogStores } from "./infrastructure/bodylog-store-ports.ts";
import {
  InMemoryBodyLogBuddyStore,
  InMemoryBodyLogFeatureFlagStore,
  InMemoryBodyLogGroupStore,
  InMemoryBodyLogGrowthStore,
  InMemoryBodyLogNotificationStore,
  InMemoryBodyLogSubscriptionStore,
} from "./modules/bodylog/bodylog-stores.ts";

const fallbackStores = new WeakMap<ApplicationDatabase, BodyLogStores>();

/**
 * Resolves the six BodyLog domain stores from the application database.
 * Postgres gets dedicated store adapters (pool/session-context semantics
 * preserved); other databases (tests, local dev) get in-memory fallbacks.
 */
export function resolveBodyLogStores(database: ApplicationDatabase): BodyLogStores {
  if (database instanceof PostgresDatabase) {
    return {
      jobs: database.getBodyLogJobStore(),
      buddy: database.getBodyLogBuddyStore(),
      group: database.getCheckInGroupStore(),
      subscription: database.getSubscriptionStore(),
      growth: database.getGrowthStore(),
      notification: database.getBodyLogNotificationStore(),
      flags: database.getBodyLogFeatureFlagStore(),
    };
  }
  const existing = fallbackStores.get(database);
  if (existing) return existing;
  const completedJobs = new Set<string>();
  const stores: BodyLogStores = {
    jobs: {
      runOnce: (key, job) => database.withExclusiveSession(async () => {
        if (completedJobs.has(key)) return false;
        await job();
        completedJobs.add(key);
        return true;
      }),
    },
    buddy: new InMemoryBodyLogBuddyStore(),
    group: new InMemoryBodyLogGroupStore(),
    subscription: new InMemoryBodyLogSubscriptionStore(),
    growth: new InMemoryBodyLogGrowthStore(),
    notification: new InMemoryBodyLogNotificationStore(),
    flags: new InMemoryBodyLogFeatureFlagStore(),
  };
  fallbackStores.set(database, stores);
  return stores;
}
