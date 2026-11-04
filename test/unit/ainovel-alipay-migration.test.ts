import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("historical billing constraint replay accepts later Alipay states", async () => {
  const root = new URL("../../src/infrastructure/database/postgres/migrations/", import.meta.url);
  const early = await readFile(new URL("068_ai_novel_billing_unknown_evidence.sql", root), "utf8");
  const later = await readFile(new URL("071_ai_novel_alipay_orders.sql", root), "utf8");
  const earlyStates = new Set(early.match(/'[^']+'/g));
  const laterStates = later.split("status IN (")[1].split(")")[0].match(/'[^']+'/g)!;
  for (const state of laterStates) assert.ok(earlyStates.has(state), `Replay cannot remove ${state}`);
});

test("historical order-ID constraint replay preserves business-format IDs", async () => {
  const root = new URL("../../src/infrastructure/database/postgres/migrations/", import.meta.url);
  for (const name of ["072_ai_novel_order_product_prefix.sql", "073_ai_novel_order_business_identity.sql"]) {
    const sql = await readFile(new URL(name, root), "utf8");
    const pattern = sql.match(/order_id ~ '([^']+)'/)![1];
    assert.match("ow_web_a01_user_b_ac13b0da653a6755", new RegExp(pattern));
    assert.match(`alp_${"a".repeat(32)}`, new RegExp(pattern));
  }
});
