import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { BuddySupportCommand } from "../../src/modules/frogsleep/buddy-support/buddy-support-command.ts";
import { BuddySupportQuery } from "../../src/modules/frogsleep/buddy-support/buddy-support-query.ts";

async function setup() {
  const db = new InMemoryDatabase(buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true }));
  for (const userId of ["user_alice", "user_bob"]) {
    if (!await db.findAppUser("frogsleep", userId)) await db.insertAppUser({ id: `support_${userId}`, appId: "frogsleep", userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
  }
  for (const domain of ["sleep", "focus"] as const) {
    const now = new Date().toISOString();
    await db.insertFrogSleepEntity({ id: `support_${domain}`, appId: "frogsleep", kind: `${domain}_relationship`,
      ownerUserId: "user_alice", partnerUserId: "user_bob", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
  }
  const command = new BuddySupportCommand(db);
  for (const domain of ["sleep", "focus"]) await command.enroll("user_alice", `support_${domain}`);
  return { db, command, query: new BuddySupportQuery(db) };
}
const send = (id: string, domain = "sleep") => ({ relationship_id: `support_${domain}`, operation_id: id,
  template_key: domain === "sleep" ? "sleep_goodnight" : "focus_start_small", flower: true, context: null });
const permission = (id: string, enabled: boolean, revision = 0) => ({ enabled, expected_revision: revision, operation_id: id });

test("sleep-only support is explicit, directional and independent of summary grants", async () => {
  const { db, command, query } = await setup();
  await db.updateFrogSleepEntity("focus_relationship", "frogsleep", "support_focus", { status: "revoked" });
  await assert.rejects(command.send("user_alice", send("before-consent")), /unavailable/i);
  await command.setReceiving("user_bob", "support_sleep", permission("enable", true));
  const result = await command.send("user_alice", send("once"));
  assert.equal(result.note.domain, "sleep");
  assert.equal((await query.history("user_bob", {})).notes.length, 1);
  await assert.rejects(command.send("user_bob", send("reverse")), /unavailable/i);
  assert.equal(db.frogSleepBuddyNotificationOutbox.length, 0);
});

test("sending is idempotent and cross-domain concurrent quota is atomic", async () => {
  const { command } = await setup();
  for (const domain of ["sleep", "focus"]) await command.setReceiving("user_bob", `support_${domain}`, permission(`enable-${domain}`, true));
  const first = await command.send("user_alice", send("first"));
  assert.equal((await command.send("user_alice", send("first"))).note.id, first.note.id);
  await assert.rejects(command.send("user_alice", { ...send("first"), flower: false }), /conflict/i);
  await command.send("user_alice", send("second", "focus"));
  const competing = await Promise.allSettled([command.send("user_alice", send("third")), command.send("user_alice", send("fourth", "focus"))]);
  assert.equal(competing.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(competing.filter(x => x.status === "rejected").length, 1);
});

test("resolution wins or observes original send without duplicate creation", async () => {
  const { command, query } = await setup();
  await command.setReceiving("user_bob", "support_sleep", permission("enable", true));
  assert.equal((await query.operation("user_alice", "late")).operation.state, "not_found");
  assert.equal((await command.resolve("user_alice", "late", { relationship_id: "support_sleep", submission: send("late") })).operation.state, "not_sent");
  await assert.rejects(command.send("user_alice", send("late")), /closed/i);
  const accepted = await command.send("user_alice", send("accepted"));
  const resolved = await command.resolve("user_alice", "accepted", { relationship_id: "support_sleep", submission: send("accepted") });
  assert.equal(resolved.operation.resource_id, accepted.note.id);
  assert.equal((await query.history("user_bob", {})).notes.length, 1);
});

test("receive-off retains history, acknowledgement is single, pause hides only its domain", async () => {
  const { db, command, query } = await setup();
  await command.setReceiving("user_bob", "support_sleep", permission("enable", true));
  const { note } = await command.send("user_alice", send("one"));
  await command.setReceiving("user_bob", "support_sleep", permission("off", false, 1));
  assert.equal((await query.history("user_bob", {})).notes.length, 1);
  await command.acknowledge("user_bob", note.id, { operation_id: "ack" });
  await command.acknowledge("user_bob", note.id, { operation_id: "ack" });
  assert.equal((await query.detail("user_alice", note.id)).note.acknowledged, true);
  await assert.rejects(command.acknowledge("user_alice", note.id, { operation_id: "self-ack" }));
  await db.updateFrogSleepEntity("sleep_relationship", "frogsleep", "support_sleep", { status: "paused" });
  assert.equal((await query.history("user_bob", {})).notes.length, 0);
  assert.equal((await query.capabilities("user_alice", "support_focus")).capability.can_read_history, true);
});

test("content validates fields, domain, caller and optimistic permission version", async () => {
  const { command } = await setup();
  await command.setReceiving("user_bob", "support_sleep", permission("enable", true));
  await assert.rejects(command.setReceiving("user_bob", "support_sleep", permission("stale", false)), /revision/i);
  await assert.rejects(command.send("user_alice", { ...send("raw"), custom_text: "private" }));
  await assert.rejects(command.send("user_alice", { ...send("wrong"), template_key: "focus_start_small" }));
  await assert.rejects(command.send("user_charlie", send("outsider")));
  const onlyFlower = await command.send("user_alice", { ...send("flower"), template_key: null });
  assert.equal(onlyFlower.note.flower, true);
});


test("own durable sending outcome remains resolvable after relationship revocation without exposing content", async () => {
  const { db, command, query } = await setup();
  await command.setReceiving("user_bob", "support_sleep", permission("enable", true));
  await command.send("user_alice", send("committed"));
  await db.updateFrogSleepEntity("sleep_relationship", "frogsleep", "support_sleep", { status: "revoked" });
  const result = await command.resolve("user_alice", "committed", { relationship_id: "support_sleep", submission: send("committed") });
  assert.equal(result.operation.state, "accepted");
  assert.equal("note" in result, false);
  assert.equal((await query.history("user_alice", {})).notes.length, 0);
  await assert.rejects(command.resolve("user_bob", "committed", { relationship_id: "support_sleep", submission: send("committed") }));
});


test("history uses stable tuple pagination and binds cursors to the actor and domain filter", async () => {
  const { db, command, query } = await setup();
  await command.setReceiving("user_bob", "support_sleep", permission("enable", true));
  const { note } = await command.send("user_alice", send("page-seed"));
  for (let index = 0; index < 5; index++) {
    const { acknowledged: _, can_acknowledge: __, ...record } = note;
    await db.getBuddySupportRepository().insertNote({ ...record, id: `page_${index}` });
  }
  const ids: string[] = []; let cursor: string | null = null;
  do {
    const page = await query.history("user_bob", { limit: "2", ...(cursor ? { cursor } : {}) });
    ids.push(...page.notes.map(x => x.id)); cursor = page.next_cursor;
  } while (cursor);
  assert.equal(ids.length, 6); assert.equal(new Set(ids).size, 6);
  const first = await query.history("user_bob", { limit: "2" });
  await assert.rejects(query.history("user_alice", { cursor: first.next_cursor }));
  await assert.rejects(query.history("user_bob", { domain: "focus", cursor: first.next_cursor }));
});


test("focus-only, pause/resume, new relation and expired content obey independent visibility", async () => {
  const { db, command, query } = await setup();
  await db.updateFrogSleepEntity("sleep_relationship", "frogsleep", "support_sleep", { status: "revoked" });
  await command.setReceiving("user_bob", "support_focus", permission("focus-enable", true));
  const { note } = await command.send("user_alice", send("focus-only", "focus"));
  assert.equal((await query.history("user_bob", {})).notes[0].domain, "focus");
  await db.updateFrogSleepEntity("focus_relationship", "frogsleep", "support_focus", { status: "paused" });
  assert.equal((await query.history("user_bob", {})).notes.length, 0);
  await db.updateFrogSleepEntity("focus_relationship", "frogsleep", "support_focus", { status: "accepted" });
  assert.equal((await query.history("user_bob", {})).notes.length, 1);
  await db.updateFrogSleepEntity("focus_relationship", "frogsleep", "support_focus", { status: "revoked" });
  const now = new Date().toISOString();
  await db.insertFrogSleepEntity({ id: "new_focus", appId: "frogsleep", kind: "focus_relationship", ownerUserId: "user_alice",
    partnerUserId: "user_bob", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
  await command.enroll("user_alice", "new_focus");
  assert.equal((await query.capabilities("user_bob", "new_focus")).capability.own_receive_enabled, false);
  assert.equal((await query.history("user_bob", {})).notes.length, 0);
  await assert.rejects(query.detail("user_bob", note.id));
});

test("30-day boundary hides content immediately before physical cleanup", async () => {
  const { db, command, query } = await setup();
  await command.setReceiving("user_bob", "support_sleep", permission("enable", true));
  const { note } = await command.send("user_alice", send("expiration-seed"));
  const { acknowledged: _, can_acknowledge: __, ...record } = note;
  await db.getBuddySupportRepository().insertNote({ ...record, id: "expired-note", created_at: new Date(Date.now() - 30 * 86400000).toISOString(), expires_at: new Date(Date.now() - 1).toISOString() });
  assert.equal((await query.history("user_bob", {})).notes.some(x => x.id === "expired-note"), false);
  await assert.rejects(query.detail("user_bob", "expired-note"));
  await db.getBuddySupportRepository().cleanup("frogsleep", new Date().toISOString());
  assert.equal(await db.getBuddySupportRepository().note("frogsleep", "expired-note"), undefined);
  assert.equal((await query.history("user_bob", {})).notes.length, 1);
});
