import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ErrorRecordsService } from "../../src/modules/lighttick/error-records/error-records.service.ts";
const o = { appId: "lighttick" as const, userId: "errors-alice" },
  body = {
    base_version: 0,
    date: "2026-11-15",
    module_id: "general",
    category_id: "builtin-bias",
    description: "判断条件遗漏 %_",
    severity: 3,
    context: "项目讨论",
    improvement_action: "先写出证据清单",
    is_repeat: false,
    related_error_id: null,
  };
const setup = () => {
  const repo = new InMemoryLightTickRepository();
  return {
    repo,
    s: new ErrorRecordsService(repo, () => new Date("2026-11-15T08:00:00Z")),
  };
};
test("error records preserve explicit repeat and linked history, CAS/replay and literal filters without task writes", async () => {
  const { repo, s } = setup();
  const first = await s.save(o, "error-first", body, "errors-first-key");
  const second = await s.save(
    o,
    "error-second",
    {
      ...body,
      is_repeat: true,
      related_error_id: first.id,
      description: "再次遗漏",
    },
    "errors-second-key",
  );
  assert.equal(second.version, 1);
  assert.deepEqual(
    await s.save(
      o,
      "error-first",
      Object.fromEntries(Object.entries(body).reverse()),
      "errors-first-key",
    ),
    first,
  );
  const page = await s.list(o, { q: "%_" });
  assert.equal(page.total, 1);
  assert.equal((await s.list(o, { repeat: "true" })).items[0].id, second.id);
  assert.equal((await s.list(o, {})).stats.repeated, 1);
  assert.equal((await s.detail(o, first.id)).linked_from.total, 1);
  assert.equal((await s.detail(o, second.id)).related?.id, first.id);
  assert.equal((await repo.listTasks(o)).length, 0);
  await assert.rejects(
    s.save(o, first.id, { ...body, base_version: 0 }, "stale-first-key"),
  );
  await s.archive(
    o,
    first.id,
    { base_version: 1, archived: true },
    "archive-first-key",
  );
  assert.equal((await s.detail(o, second.id)).related?.archived, true);
  assert.equal((await s.list(o, {})).total, 1);
});
test("links are owner scoped, cannot self-link or cycle; rejected writes and rollback leave no receipt", async () => {
  const { repo, s } = setup();
  await s.save(o, "error-first", body, "first-owner-key");
  await s.save(
    o,
    "error-second",
    { ...body, related_error_id: "error-first" },
    "second-owner-key",
  );
  await assert.rejects(
    s.save(
      o,
      "error-first",
      { ...body, base_version: 1, related_error_id: "error-second" },
      "cycle-owner-key",
    ),
  );
  await assert.rejects(
    s.save(
      o,
      "error-self",
      { ...body, related_error_id: "error-self" },
      "self-link-key",
    ),
  );
  await assert.rejects(s.detail({ ...o, userId: "other" }, "error-first"));
  await assert.rejects(
    repo.transaction(o, async () => {
      await s.save(o, "error-rollback", body, "rollback-errors-key");
      throw Error("rollback");
    }),
  );
  await assert.rejects(s.receipt(o, "rollback-errors-key"));
  for (const date of ["2026-02-30", "2026-13-01"])
    await assert.rejects(
      s.save(o, "error-date", { ...body, date }, "date-error-key"),
    );
  assert.equal(
    (await s.list({ ...o, userId: "other" }, {})).stats.repeat_rate,
    null,
  );
});
test("custom category names are unique, referenced categories cannot be deleted, archive/restore retains classification", async () => {
  const { s } = setup();
  const type = await s.createCategory(
    o,
    { name: "核对不足", description: "缺少证据" },
    "create-error-type",
  );
  await assert.rejects(
    s.createCategory(
      o,
      { name: " 核对不足 ", description: "" },
      "duplicate-error-type",
    ),
  );
  await s.save(
    o,
    "error-classified",
    { ...body, category_id: type.id },
    "classified-error-key",
  );
  await assert.rejects(
    s.deleteCategory(o, type.id, { base_version: 1 }, "remove-used-type"),
  );
  await s.archive(
    o,
    "error-classified",
    { base_version: 1, archived: true },
    "archive-classified",
  );
  await assert.rejects(
    s.deleteCategory(o, type.id, { base_version: 1 }, "remove-archived-type"),
  );
  await s.archive(
    o,
    "error-classified",
    { base_version: 2, archived: false },
    "restore-classified",
  );
  assert.equal((await s.list(o, {})).total, 1);
  const unused = await s.createCategory(
    o,
    { name: "临时分类", description: "" },
    "unused-type-key",
  );
  await s.deleteCategory(
    o,
    unused.id,
    { base_version: 1 },
    "remove-unused-key",
  );
  assert.equal(
    (await s.catalog(o)).categories.some((t) => t.id === unused.id),
    false,
  );
});
test("relationship lookup finds older history outside the default review window and omits archived candidates", async () => {
  const { s } = setup();
  await s.save(
    o,
    "error-older",
    { ...body, date: "2020-01-01", description: "旧经验" },
    "older-error-key",
  );
  assert.equal((await s.list(o, {})).total, 0);
  assert.equal((await s.lookup(o, { q: "旧经验" })).items[0].id, "error-older");
  await s.archive(
    o,
    "error-older",
    { base_version: 1, archived: true },
    "older-archive-key",
  );
  assert.equal((await s.lookup(o, { q: "旧经验" })).total, 0);
});
