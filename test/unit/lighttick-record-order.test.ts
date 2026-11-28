import assert from "node:assert/strict";
import test from "node:test";
import { LightTickRecordService, recordCursorKey, selectRecordRows, type LightTickRecordRow } from "../../src/modules/lighttick/lighttick-record.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const row = (id: string, created: string): LightTickRecordRow => ({
  appId: "lighttick", userId: "u1", id, version: 1,
  payload: {
    id, raw_text: `${id} 的内容`, record_date: "2026-11-28", prompt_kind: "free",
    guided_answers: {}, tags: [], version: 1, created_at: created, updated_at: created,
  },
});

/**
 * 同一天记多条时，id 是随机 UUID，旧排序（record_date, id）会让刚记下的那条
 * 落到列表第 10 位、被「本月只显示 8 条」折叠掉，用户以为没保存。
 */
test("同一天的记录按创建时间倒序，游标翻页不重复不丢", () => {
  const rows = [
    row("rec-a", "2026-11-28T01:05:00.000Z"),
    row("rec-b", "2026-11-28T03:00:00.000Z"),
    row("rec-c", "2026-11-28T00:10:00.000Z"),
    row("rec-d", "2026-11-27T23:00:00.000Z"),
  ];
  const first = selectRecordRows(rows, { archived: "false", limit: 2 });
  assert.deepEqual(first.map((x) => x.id), ["rec-b", "rec-a"], "今天最新的两条在前");

  const cursor = recordCursorKey(first.at(-1)!.payload);
  const second = selectRecordRows(rows, { archived: "false", limit: 2, after: cursor });
  assert.deepEqual(second.map((x) => x.id), ["rec-c", "rec-d"], "翻页从游标之后继续，不重复");
  assert.equal(new Set([...first, ...second].map((x) => x.id)).size, 4, "两页合起来正好覆盖全部");
});

test("旧版 date:id 游标仍然可解析，只按 id 翻页", () => {
  const rows = [row("rec-zzz", "2026-11-28T09:00:00.000Z"), row("rec-aaa", "2026-11-28T08:00:00.000Z")];
  const legacy = "2026-11-28:rec-zzz";
  assert.deepEqual(selectRecordRows(rows, { archived: "false", limit: 10, after: legacy }).map((x) => x.id), ["rec-aaa"]);
});

test("服务层生成的游标能原样翻页（新格式与数据一起验）", async () => {
  const repo = new InMemoryLightTickRepository();
  const service = new LightTickRecordService(repo);
  const owner = { appId: "lighttick" as const, userId: "alice" };
  for (const id of ["record-page-A", "record-page-B", "record-page-C"])
    await service.mutate(owner, id, "save", { raw_text: "同一天的三条", record_date: "2026-10-19", base_version: 0 }, "key-" + id);
  const first = await service.list(owner, { limit: "1" });
  const second = await service.list(owner, { limit: "1", cursor: first.next_cursor });
  assert.notEqual(first.items[0].id, second.items[0].id);
  const third = await service.list(owner, { limit: "1", cursor: second.next_cursor });
  assert.equal(new Set([first.items[0].id, second.items[0].id, third.items[0].id]).size, 3, "三页各取一条，不重复");
});
