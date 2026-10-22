import assert from "node:assert/strict";
import { PersonalSyncService } from "../../src/modules/frogsleep/personal-sync/personal-sync.service.ts";
import { encodePersonalCursor } from "../../src/modules/frogsleep/personal-sync/personal-sync-cursor.ts";
import type { PersonalSyncRepository } from "../../src/modules/frogsleep/personal-sync/personal-sync.types.ts";

export async function verifyPersonalWrites(repo: PersonalSyncRepository) {
  const service = new PersonalSyncService(repo);
  const before = await service.state("user_alice");
  const responses = await Promise.all(Array.from({ length: 16 }, () => service.write("user_alice", "sleep_report", "same-id", { minutes: 430 }, false, { operationKey: "concurrent-write" })));
  assert.ok(responses.every(r => r.sequence === before.sequence + 1 && r.revision === 1));
  await assert.rejects(service.write("user_alice", "sleep_report", "same-id", { minutes: 450 }, false, { operationKey: "concurrent-write" }), { code: "FROGSLEEP_SYNC_IDEMPOTENCY_CONFLICT" });
  const other = await service.write("user_bob", "sleep_report", "same-id", { minutes: 200 }, false, { operationKey: "concurrent-write" });
  assert.equal(other.data.minutes, 200); assert.equal((await service.get("user_alice", "sleep_report", "same-id")).data.minutes, 430);
  const changed = await service.write("user_alice", "sleep_report", "same-id", { minutes: 450 }, false, { operationKey: "revision-2", expectedRevision: 1 });
  assert.equal(changed.revision, 2); assert.equal(changed.created_at, responses[0].created_at);
  await assert.rejects(service.write("user_alice", "sleep_report", "same-id", { minutes: 450 }, false, { operationKey: "stale-revision", expectedRevision: 1 }), { code: "FROGSLEEP_SYNC_REVISION_CONFLICT" });
  const equal = await service.write("user_alice", "sleep_report", "same-id", { minutes: 450 }, false, { operationKey: "equal-content", expectedRevision: 2 });
  assert.equal(equal.sequence, changed.sequence);
  await assert.rejects(service.write("user_alice", "sleep_report", "same-id", { minutes: 451 }, false, { operationKey: "equal-content", expectedRevision: 2 }), { code: "FROGSLEEP_SYNC_IDEMPOTENCY_CONFLICT" });
}
export async function verifyPersonalPages(repo: PersonalSyncRepository) {
  const service = new PersonalSyncService(repo);
  for (let i=0;i<530;i++) await service.write("user_alice", "sleep_report", `page-${i}`, { date: "2026-10-11", value: i }, false);
  const browse = await service.browse("user_alice",73);
  let browsePage=browse; const browsed=[...browse.items];
  while(browsePage.pagination.next_cursor) { browsePage=await service.browse("user_alice",73,browsePage.pagination.next_cursor); browsed.push(...browsePage.items); }
  assert.equal(browsed.filter(r=>r.id.startsWith("page-")).length,530);
  assert.equal(new Set(browsed.map(r=>r.id)).size,browsed.length);
  const first = await service.page("user_alice", "restore", 73);
  await service.write("user_alice", "sleep_report", "page-529", { value: "changed" }, false, { expectedRevision: 1 });
  await service.write("user_alice", "sleep_report", "page-528", {}, true, { expectedRevision: 1 });
  await service.write("user_alice", "sleep_report", "created-after-boundary", { value: "new" }, false);
  let page = first; const all = [...first.items];
  while(page.pagination.next_cursor) { page = await service.page("user_alice", "restore", 73, page.pagination.next_cursor); all.push(...page.items); }
  assert.equal(all.filter(r => r.id.startsWith("page-")).length, 530);
  assert.equal(new Set(all.map(r => `${r.kind}:${r.id}`)).size, all.length);
  assert.equal(all.find(r => r.id === "page-529")!.data.value, 529);
  assert.equal(all.find(r => r.id === "page-528")!.deleted, false);
  assert.equal(all.some(r => r.id === "created-after-boundary"), false);
  const incremental = await service.page("user_alice", "changes", 100, first.changes_cursor);
  assert.deepEqual(incremental.items.map(r => r.id), ["page-529","page-528","created-after-boundary"]);
  assert.equal(incremental.items[1].deleted, true);
  assert.ok(incremental.items[0].sequence < incremental.items[1].sequence);
  await assert.rejects(service.page("user_bob", "restore", 73, first.pagination.next_cursor!), { code: "FROGSLEEP_SYNC_CURSOR_INVALID" });
  await assert.rejects(service.page("user_alice", "restore", 73, first.pagination.next_cursor! + "tampered"), { code: "FROGSLEEP_SYNC_CURSOR_INVALID" });
  const expired = await repo.run("user_alice", async tx => encodePersonalCursor({ user: "user_alice", epoch: tx.state.epoch, mode: "restore", boundary: tx.state.sequence, after: 0, expires: Date.now() - 1 }, tx.state));
  await assert.rejects(service.page("user_alice", "restore", 73, expired), { code: "FROGSLEEP_SYNC_CURSOR_INVALID" });
}
export async function verifyPersonalDelete(repo: PersonalSyncRepository) {
  const service = new PersonalSyncService(repo);
  const first = await service.write("user_alice", "sleep_report", "delete-race", { private: true }, false, { operationKey: "before-delete" });
  const requests = await Promise.allSettled([
    service.write("user_alice", "sleep_report", "delete-race", {}, true, { operationKey: "delete", expectedRevision: first.revision }),
    service.write("user_alice", "sleep_report", "delete-race", { private: true }, false, { operationKey: "before-delete" }),
  ]);
  assert.equal(requests[0].status, "fulfilled");
  await assert.rejects(service.get("user_alice", "sleep_report", "delete-race"), { code: "FROGSLEEP_SYNC_RESOURCE_NOT_FOUND" });
  await assert.rejects(service.write("user_alice", "sleep_report", "delete-race", { private: true }, false, { operationKey: "before-delete" }), { code: "FROGSLEEP_SYNC_RESOURCE_DELETED" });
  const tombstone = await service.write("user_alice", "sleep_report", "delete-race", {}, true, { operationKey: "delete", expectedRevision: first.revision });
  assert.equal(tombstone.revision, 2); assert.deepEqual(tombstone.data, {});
  await service.write("user_alice", "report_preferences", "report_preferences", { schema_version: "1", state: { week_start: "monday" } }, false);
  await assert.rejects(service.write("user_alice", "report_preferences", "report_preferences", { state: {} }, false), { code: "FROGSLEEP_SYNC_REVISION_CONFLICT" });
}
