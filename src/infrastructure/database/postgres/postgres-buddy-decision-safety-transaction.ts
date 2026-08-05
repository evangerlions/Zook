import { AsyncLocalStorage } from "node:async_hooks";
import {
  normalizeFrogSleepBuddyInvitationDecisionSafetyKey,
  serializeFrogSleepBuddyInvitationDecisionSafetyKey,
  type FrogSleepBuddyInvitationDecisionSafetyKey,
} from "../../../modules/frogsleep/buddy-growth/buddy-decision-safety-key.ts";

interface DecisionSafetyTransactionClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

interface TransactionContext<Client> {
  client: Client;
  key: string;
}

/** Atomically updates one invitation decision and its outbox event without slot writes. */
export class PostgresBuddyDecisionSafetyTransaction<Client extends DecisionSafetyTransactionClient> {
  private readonly context = new AsyncLocalStorage<TransactionContext<Client>>();

  constructor(private readonly dependencies: {
    connect: () => Promise<Client>;
    runWithClient: <T>(client: Client, fn: () => Promise<T>) => Promise<T>;
  }) {}

  async run<T>(key: FrogSleepBuddyInvitationDecisionSafetyKey, fn: () => Promise<T> | T): Promise<T> {
    const normalized = normalizeFrogSleepBuddyInvitationDecisionSafetyKey(key);
    const serialized = serializeFrogSleepBuddyInvitationDecisionSafetyKey(normalized);
    const existing = this.context.getStore();
    if (existing) {
      if (existing.key !== serialized) throw new Error("Nested transaction requested an additional buddy decision safety key.");
      return await fn();
    }
    const client = await this.dependencies.connect();
    return await this.runRoot(client, normalized, serialized, fn);
  }

  private async runRoot<T>(
    client: Client,
    key: FrogSleepBuddyInvitationDecisionSafetyKey,
    serialized: string,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    try {
      await client.query("BEGIN");
      await this.lockDecision(client, key);
      const result = await this.context.run({ client, key: serialized }, async () =>
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

  private async lockDecision(client: Client, key: FrogSleepBuddyInvitationDecisionSafetyKey): Promise<void> {
    const result = await client.query(
      `SELECT app_id, invitation_id, domain FROM zook_frogsleep_buddy_invitation_domain_decisions
       WHERE app_id=$1 AND invitation_id=$2 AND domain=$3 FOR UPDATE`,
      [key.appId, key.invitationId, key.domain],
    );
    if (!result.rows[0]) throw new Error("Buddy decision safety transaction decision was not found.");
  }
}
