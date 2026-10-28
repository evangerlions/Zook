import { InMemoryCache } from "./infrastructure/cache/redis/in-memory-cache.ts";
import { PostgresDatabase } from "./infrastructure/database/postgres/postgres-database.ts";

import { InMemoryKVBackend, KVManager } from "./infrastructure/kv/kv-manager.ts";
import { ManagedStateStore, applyManagedState } from "./infrastructure/kv/managed-state.store.ts";

import { InMemoryJobQueue } from "./infrastructure/queue/bullmq/in-memory-queue.ts";
import { RedisJobQueue } from "./infrastructure/queue/bullmq/redis-queue.ts";

import { resolveRuntimeDatabaseUrl, resolveRuntimeMigrationDatabaseUrl, resolveRuntimeRedisUrl } from "./infrastructure/runtime/runtime-readiness.ts";

import { resolveApplicationLightTickRepository } from "./application-lighttick-services.ts";

import type { CreateApplicationOptions } from "./application-options.ts";

import type { DatabaseSeed } from './shared/types.ts';
export async function createApplicationInfrastructure(options: CreateApplicationOptions, baseSeed: DatabaseSeed) {

  const kvManager =
    options.kvManager ??
    (options.kvBackend
      ? await KVManager.create({ backend: options.kvBackend })
      : resolveRuntimeRedisUrl()
        ? await KVManager.getShared({ redisUrl: resolveRuntimeRedisUrl() })
        : await KVManager.create({ backend: new InMemoryKVBackend() }));
  const shouldLoadManagedState = Boolean(
    options.database || options.databaseFactory,
  );
  const managedStateStore = new ManagedStateStore(kvManager, {
    enabled: shouldLoadManagedState,
  });
  const seed = shouldLoadManagedState
    ? applyManagedState(baseSeed, await managedStateStore.load())
    : baseSeed;
  const database =
    options.database ??
    (options.databaseFactory
      ? await options.databaseFactory(seed)
      : await PostgresDatabase.create(
          options.databaseUrl?.trim() ||
            resolveRuntimeDatabaseUrl() ||
            (() => {
              throw new Error(
                "DATABASE_URL must be configured before starting PostgreSQL.",
              );
            })(),
          seed,
          {
            migrationConnectionString:
              options.migrationDatabaseUrl?.trim() ||
              resolveRuntimeMigrationDatabaseUrl(),
          },
        ));
  const lighttickRepository = resolveApplicationLightTickRepository(database, options.lighttickRepository);
  const cache = new InMemoryCache();
  const defaultQueueBackend =
    options.queueRedisUrl?.trim() || resolveRuntimeRedisUrl()
      ? "redis"
      : "memory";
  const resolvedQueueBackend = options.queueBackend ?? defaultQueueBackend;
  const queue =
    options.queue ??
    (resolvedQueueBackend === "redis"
      ? new RedisJobQueue(
          options.queueRedisUrl?.trim() ||
            resolveRuntimeRedisUrl() ||
            (() => {
              throw new Error(
                "REDIS_URL must be configured before starting the Redis job queue backend.",
              );
            })(),
        )
      : new InMemoryJobQueue());
  return { kvManager, managedStateStore, seed, database, lighttickRepository, cache, queue };
}
