import { AsyncLocalStorage } from "node:async_hooks";

import {
  normalizeFrogSleepBuddyCommandSlotKeys,
  serializeFrogSleepBuddyCommandSlotKey,
  type FrogSleepBuddyCommandSlotKey,
} from "../../../modules/frogsleep/buddy-growth/buddy-command-slot-keys.ts";
export type { FrogSleepBuddyCommandSlotKey } from "../../../modules/frogsleep/buddy-growth/buddy-command-slot-keys.ts";

interface BuddyCommandTransactionClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

interface TransactionContext<Client> {
  client: Client;
  lockedKeys: Set<string>;
}

/** Runs buddy commands on one PostgreSQL connection with deterministic slot locks. */
export class PostgresBuddyCommandTransaction<Client extends BuddyCommandTransactionClient> {
  private readonly context = new AsyncLocalStorage<TransactionContext<Client>>();

  constructor(private readonly dependencies: {
    connect: () => Promise<Client>;
    runWithClient: <T>(client: Client, fn: () => Promise<T>) => Promise<T>;
  }) {}

  async run<T>(slotKeys: FrogSleepBuddyCommandSlotKey[], fn: () => Promise<T> | T): Promise<T> {
    const keys = normalizeFrogSleepBuddyCommandSlotKeys(slotKeys);
    const existing = this.context.getStore();
    if (existing) {
      this.assertNestedSubset(keys, existing.lockedKeys);
      return await fn();
    }
    const client = await this.dependencies.connect();
    return await this.runRoot(client, keys, fn);
  }

  private async runRoot<T>(
    client: Client,
    keys: FrogSleepBuddyCommandSlotKey[],
    fn: () => Promise<T> | T,
  ): Promise<T> {
    try {
      await client.query("BEGIN");
      for (const key of keys) await this.ensureSlot(client, key);
      for (const key of keys) await this.lockSlot(client, key);
      const lockedKeys = new Set(keys.map(serializeFrogSleepBuddyCommandSlotKey));
      const result = await this.context.run({ client, lockedKeys }, async () =>
        await this.dependencies.runWithClient(client, async () => await fn()));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureSlot(client: Client, key: FrogSleepBuddyCommandSlotKey): Promise<void> {
    await client.query(
      `INSERT INTO zook_frogsleep_buddy_domain_slots (app_id, user_id, domain, state, relationship_id, version, created_at, updated_at)
       VALUES ($1, $2, $3, 'available', NULL, 1, NOW(), NOW())
       ON CONFLICT (app_id, user_id, domain) DO NOTHING`,
      [key.appId, key.userId, key.domain],
    );
  }

  private async lockSlot(client: Client, key: FrogSleepBuddyCommandSlotKey): Promise<void> {
    const result = await client.query(
      `SELECT app_id, user_id, domain FROM zook_frogsleep_buddy_domain_slots
       WHERE app_id = $1 AND user_id = $2 AND domain = $3
       FOR UPDATE`,
      [key.appId, key.userId, key.domain],
    );
    if (!result.rows[0]) throw new Error("Buddy command transaction slot was not found after ensure and lock.");
  }

  private assertNestedSubset(keys: FrogSleepBuddyCommandSlotKey[], lockedKeys: Set<string>): void {
    if (keys.some((key) => !lockedKeys.has(serializeFrogSleepBuddyCommandSlotKey(key)))) {
      throw new Error("Nested transaction requested an additional buddy command transaction slot.");
    }
  }
}
