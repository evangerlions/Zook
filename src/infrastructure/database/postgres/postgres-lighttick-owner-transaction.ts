import { AsyncLocalStorage } from "node:async_hooks";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
export type QueryResult = {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
};
export type QueryClient = {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release?(): void;
};
export type Connector = QueryClient & { connect(): Promise<QueryClient> };
export class LightTickOwnerTransactionGate {
  private readonly session = new AsyncLocalStorage<{
    client: QueryClient;
    owners: Set<string>;
  }>();
  constructor(
    private readonly connector: Connector,
    private readonly transactionRunner?: <T>(
      operation: () => Promise<T>,
    ) => Promise<T>,
  ) {}
  get active() {
    return !!this.session.getStore();
  }
  query(sql: string, values: unknown[] = []) {
    return (this.session.getStore()?.client ?? this.connector).query(
      sql,
      values,
    );
  }
  async transactionOwners<T>(
    owners: LightTickOwner[],
    operation: () => Promise<T>,
  ): Promise<T> {
    if (
      !owners.length ||
      owners.some((owner) => owner.appId !== "lighttick" || !owner.userId)
    )
      throw new Error("Valid LightTick owners required");
    const keys = [
      ...new Set(
        owners.map((owner) => `lighttick-owner:${owner.appId}:${owner.userId}`),
      ),
    ].sort();
    const active = this.session.getStore();
    if (active) {
      if (keys.some((key) => !active.owners.has(key)))
        throw new Error(
          "Nested transaction cannot acquire an undeclared owner",
        );
      return operation();
    }
    const run = async (client: QueryClient) => {
      for (const key of keys)
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [key],
        );
      return this.session.run({ client, owners: new Set(keys) }, operation);
    };
    // An injected runner owns the transaction on the supplied, bound connector.
    if (this.transactionRunner)
      return this.transactionRunner(() => run(this.connector));
    const client = await this.connector.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release?.();
    }
  }
}
