import { ApplicationError } from "../../../shared/errors.ts";
import { searchCreditUsers, listCreditGrants } from "./postgres-ai-novel-credit-admin.ts";
import { billingEnvironment } from "../../../modules/billing/billing-environment.ts";
import type { PoolClient } from "pg";
import type { AiNovelCreditsStore, CreditsTransaction } from "../../../modules/ai-novel/credits/ai-novel-credits-model.ts";
import { persistCreditReporting } from "./postgres-credit-reporting.ts";
import { readAiNovelUsage } from "./postgres-ai-novel-usage.ts";

/** Per-user row locks, never the application's global advisory lock. */
export class PostgresAiNovelCreditsStore implements AiNovelCreditsStore {
  constructor(private readonly connect: () => Promise<PoolClient>) {}

  async transact<T>(userId: string, jobId: string, work: (state: CreditsTransaction) => T): Promise<T> {
    const environment = billingEnvironment();
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO zook_ai_novel_credit_accounts(user_id,environment) VALUES($1,$2) ON CONFLICT DO NOTHING", [userId,environment]);
      const account = await client.query("SELECT payload FROM zook_ai_novel_credit_accounts WHERE user_id=$1 AND environment=$2 FOR UPDATE", [userId,environment]);
      const job = jobId ? await client.query("SELECT payload FROM zook_ai_novel_credit_jobs WHERE user_id=$1 AND job_id=$2 AND environment=$3", [userId, jobId, environment]) : undefined;
      const state: CreditsTransaction = { account: account.rows[0]?.payload ?? undefined, job: job?.rows[0]?.payload ?? undefined };
      const result = work(state);
      if (state.account) await client.query("UPDATE zook_ai_novel_credit_accounts SET payload=$2::jsonb, updated_at=now() WHERE user_id=$1 AND environment=$3", [userId, JSON.stringify(state.account), environment]);
      if (state.job) await client.query("INSERT INTO zook_ai_novel_credit_jobs(user_id,job_id,payload,environment) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(user_id,environment,job_id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()", [userId, jobId, JSON.stringify(state.job), environment]);
      await persistCreditReporting(client, userId, state);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "constraint" in error && error.constraint === "zook_ai_novel_admin_credit_grant_key") {
        throw new ApplicationError(409, "AINOVEL_CREDITS_JOB_CONFLICT", "Grant key was already used for another user.");
      }
      throw error;
    } finally { client.release(); }
  }

  async searchUsers(field: import("../../../modules/ai-novel/credits/admin-credit-search.ts").CreditUserSearchField, term: string) {
    const client = await this.connect();
    try { return await searchCreditUsers(client, field, term); } finally { client.release(); }
  }

  async listAdminGrants(offset: number, limit: number) {
    const client = await this.connect();
    try { return await listCreditGrants(client, offset, limit); } finally { client.release(); }
  }

  async readUsageReport(filter: { from: string; to: string; userId?: string }) {
    const client = await this.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await readAiNovelUsage(client, filter);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
