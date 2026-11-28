import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresRecordStore } from "../../src/infrastructure/database/postgres/postgres-lighttick-record-store.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) || !new URL(dsn).pathname.startsWith("/grow_web_u1_"))
  throw Error("A disposable local LightTick test database is required.");

const owner: LightTickOwner = { appId: "lighttick", userId: "record-order-alice" };
const record = (id: string, created: string, date = "2026-11-28") =>
  JSON.stringify({ id, raw_text: `${id} 同一天记下的内容`, record_date: date, prompt_kind: "free",
    guided_answers: {}, tags: [], version: 1, created_at: created, updated_at: created });

/**
 * 真库验证：同一天的记录按创建时间倒序 + 游标翻页。
 * 单测跑的是内存过滤器，SQL 里的 jsonb 取值、引号、COLLATE 只有这里能验。
 */
test("same-day records page newest-first through Postgres with created_at cursor", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn });
  const store = new PostgresRecordStore((sql, values) => pool.query(sql, values));
  await pool.query("DELETE FROM zook_lighttick_records WHERE user_id=$1", [owner.userId]);

  const ids = [["record-order-a", "2026-11-28T01:00:00.000Z"], ["record-order-z", "2026-11-28T05:00:00.000Z"],
    ["record-order-m", "2026-11-28T03:00:00.000Z"], ["record-order-old", "2026-11-27T20:00:00.000Z"]] as const;
  for (const [id, created] of ids)
    await pool.query("INSERT INTO zook_lighttick_records (app_id,user_id,id,payload,record_date,version,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5,1,$6)",
      [owner.appId, owner.userId, id, record(id, created), created.slice(0, 10), created]);

  const first = await store.listRecords(owner, { archived: "false", limit: 3 });
  assert.deepEqual(first.map((r) => r.id), ["record-order-z", "record-order-m", "record-order-a"], "今天最新的在前，id 随机也不影响");

  const last = first.at(-1)!.payload;
  const cursor = `${last.record_date}|${last.created_at}|${last.id}`;
  const second = await store.listRecords(owner, { archived: "false", limit: 3, after: cursor });
  assert.deepEqual(second.map((r) => r.id), ["record-order-old"], "翻页接着往下，不重复不丢");

  // 旧客户端 cursor（date:id）仍能翻页
  const legacy = await store.listRecords(owner, { archived: "false", limit: 3, after: "2026-11-28:record-order-z" });
  assert.equal(legacy.every((r) => r.payload.record_date === "2026-11-27" || r.id < "record-order-z"), true);

  await pool.end();
});
