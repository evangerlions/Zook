import type { PoolClient } from "pg";

/** Serializes delivery across processes while committing each device receipt independently of provider calls. */
export async function withPostgresNotificationLock<T>(dependencies: {
  connect: () => Promise<PoolClient>;
  client?: PoolClient;
  runWithClient: (client: PoolClient, fn: () => Promise<T>) => Promise<T>;
}, key: string, operation: () => Promise<T> | T): Promise<T> {
  const client = dependencies.client ?? await dependencies.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`frogsleep-notification:${key}`]);
    return await dependencies.runWithClient(client, async () => await operation());
  } finally {
    let unlocked = true;
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`frogsleep-notification:${key}`]).catch(() => { unlocked = false; });
    if (!dependencies.client) client.release(!unlocked);
    else if (!unlocked) throw new Error("Notification delivery lock could not be released");
  }
}
