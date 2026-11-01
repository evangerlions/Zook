import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";

/** Apply the production migrations required by environment-scoped stores in an isolated schema. */
export async function applyBillingEnvironmentFixture(client: Pick<PoolClient, "query">): Promise<void> {
  for (const name of [
    "067_ai_novel_billing_revenuecat.sql",
    "071_ai_novel_alipay_orders.sql",
    "072_ai_novel_credits.sql",
    "074_ai_novel_credit_window_anchor.sql",
    "075_ai_novel_usage_reporting.sql",
    "076_ai_novel_billing_environment.sql",
    "077_ai_novel_billing_market.sql",
  ]) {
    const sql = await readFile(new URL(`../../../src/infrastructure/database/postgres/migrations/${name}`, import.meta.url), "utf8");
    await client.query(sql);
  }
}
