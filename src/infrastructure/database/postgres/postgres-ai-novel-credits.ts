import type { PoolClient } from "pg";
import type { AiNovelCreditsStore, CreditsTransaction } from "../../../modules/ai-novel/credits/ai-novel-credits-model.ts";

/** Per-user row locks, never the application's global advisory lock. */
export class PostgresAiNovelCreditsStore implements AiNovelCreditsStore {
  constructor(private readonly connect: () => Promise<PoolClient>) {}

  async transact<T>(userId: string, jobId: string, work: (state: CreditsTransaction) => T): Promise<T> {
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO zook_ai_novel_credit_accounts(user_id) VALUES($1) ON CONFLICT DO NOTHING", [userId]);
      const account = await client.query("SELECT payload FROM zook_ai_novel_credit_accounts WHERE user_id=$1 FOR UPDATE", [userId]);
      const job = jobId ? await client.query("SELECT payload FROM zook_ai_novel_credit_jobs WHERE user_id=$1 AND job_id=$2", [userId, jobId]) : undefined;
      const state: CreditsTransaction = { account: account.rows[0]?.payload ?? undefined, job: job?.rows[0]?.payload ?? undefined };
      const result = work(state);
      if (state.account) await client.query("UPDATE zook_ai_novel_credit_accounts SET payload=$2::jsonb, updated_at=now() WHERE user_id=$1", [userId, JSON.stringify(state.account)]);
      if (state.job) await client.query("INSERT INTO zook_ai_novel_credit_jobs(user_id,job_id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(user_id,job_id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()", [userId, jobId, JSON.stringify(state.job)]);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
