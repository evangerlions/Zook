import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { BuddySupportCommand } from "../../src/modules/frogsleep/buddy-support/buddy-support-command.ts";
import { BuddySupportQuery } from "../../src/modules/frogsleep/buddy-support/buddy-support-query.ts";

const url = process.env.FROGSLEEP_TEST_DATABASE_URL;
if (!url) throw new Error("FROGSLEEP_TEST_DATABASE_URL must identify a disposable database.");
const submission = (id: string, domain = "sleep") => ({ relationship_id: `support_sql_${domain}`,
  operation_id: id, template_key: domain === "sleep" ? "sleep_goodnight" : "focus_start_small", flower: true, context: null });

test("support uses real PostgreSQL transactions and durable results", async suite => {
  const seed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
  const first = await PostgresDatabase.create(url, seed);
  const second = await PostgresDatabase.create(url, seed);
  const a = new BuddySupportCommand(first), b = new BuddySupportCommand(second);
  try {
    await first.getBuddySupportRepository().deleteUser("frogsleep", "user_alice", ["support_sql_sleep", "support_sql_focus"]);
    await setup(first, a);
    await suite.test("cross-domain quota serializes competing independent connections", async () => {
      await a.send("user_alice", submission("sql_1"));
      await a.send("user_alice", submission("sql_2", "focus"));
      const result = await Promise.allSettled([a.send("user_alice", submission("sql_3")), b.send("user_alice", submission("sql_4", "focus"))]);
      assert.equal(result.filter(x => x.status === "fulfilled").length, 1);
      assert.equal(result.filter(x => x.status === "rejected" && x.reason.code === "BUDDY_SUPPORT_LIMIT_REACHED").length, 1);
      assert.equal((await new BuddySupportQuery(second).history("user_bob", {})).notes.length, 3);
    });
    await suite.test("committed operation survives across repository instances", async () => {
      const firstResult = await a.send("user_alice", submission("sql_1"));
      const replay = await b.send("user_alice", submission("sql_1"));
      assert.equal(firstResult.note.id, replay.note.id);
      await assert.rejects(b.send("user_alice", { ...submission("sql_1"), flower: false }), /CONFLICT/);
    });
    await suite.test("resolution tombstone rejects a late send on another connection", async () => {
      const value = await a.resolve("user_alice", "sql_late", { relationship_id: "support_sql_sleep", submission: submission("sql_late") });
      assert.equal(value.operation.state, "not_sent");
      await assert.rejects(b.send("user_alice", submission("sql_late")), /CLOSED/);
      const accepted = await b.resolve("user_alice", "sql_1", { relationship_id: "support_sql_sleep", submission: submission("sql_1") });
      assert.equal(accepted.operation.state, "accepted");
    });
    await suite.test("acknowledgement and disabled receiving preserve authorized history", async () => {
      const query = new BuddySupportQuery(second);
      const note = (await query.history("user_bob", {})).notes[0];
      await a.acknowledge("user_bob", note.id, { operation_id: "sql_ack" });
      await b.acknowledge("user_bob", note.id, { operation_id: "sql_ack" });
      assert.equal((await query.detail("user_alice", note.id)).note.acknowledged, true);
      await a.setReceiving("user_bob", "support_sql_sleep", { enabled: false, expected_revision: 1, operation_id: "sql_off" });
      assert.equal((await query.history("user_bob", {})).notes.length, 3);
    });
    await suite.test("send and resolution race converge to one durable outcome", async () => {
      await a.setReceiving("user_alice", "support_sql_focus", { enabled: true, expected_revision: 0, operation_id: "sql_reverse_enable" });
      const body = submission("sql_race", "focus");
      const [sent, resolved] = await Promise.allSettled([
        a.send("user_bob", body), b.resolve("user_bob", "sql_race", { relationship_id: "support_sql_focus", submission: body })]);
      assert.equal(resolved.status, "fulfilled");
      const outcome = await new BuddySupportQuery(second).operation("user_bob", "sql_race");
      assert.equal(outcome.operation.state, sent.status === "fulfilled" ? "accepted" : "not_sent");
      const notes = await new BuddySupportQuery(first).history("user_alice", {});
      assert.equal(notes.notes.filter(x => x.sender_id === "user_bob").length, sent.status === "fulfilled" ? 1 : 0);
    });
    await suite.test("cleanup physically removes expired notes without personal-record deletion", async () => {
      await first.getBuddySupportRepository().cleanup("frogsleep", new Date(Date.now() + 32 * 86400000).toISOString());
      assert.equal((await new BuddySupportQuery(second).history("user_bob", {})).notes.length, 0);
      assert.ok(await first.findFrogSleepEntity("sleep_relationship", "frogsleep", "support_sql_sleep"));
    });
    await suite.test("permission-off committed first prevents a queued send across independent connections", async () => {
      let cap = (await new BuddySupportQuery(first).capabilities("user_bob", "support_sql_sleep")).capability;
      await a.setReceiving("user_bob", "support_sql_sleep", { enabled: true, expected_revision: cap.permission_revision, operation_id: "sql_reenable" });
      cap = (await new BuddySupportQuery(first).capabilities("user_bob", "support_sql_sleep")).capability;
      const keys = (["sleep", "focus"] as const).flatMap(domain => ["user_alice", "user_bob"].map(userId => ({ appId: "frogsleep", userId, domain })));
      let ready!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { ready = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const held = first.withFrogSleepBuddyCommandTransaction(keys, async () => {
        await a.setReceiving("user_bob", "support_sql_sleep", { enabled: false, expected_revision: cap.permission_revision, operation_id: "sql_permission_wins" });
        ready(); await gate;
      });
      await entered;
      const pending = b.send("user_alice", submission("sql_after_off")).then(() => "sent", error => error.code);
      release(); await held;
      assert.equal(await pending, "BUDDY_SUPPORT_UNAVAILABLE");
      assert.equal((await new BuddySupportQuery(second).history("user_bob", {})).notes.length, 0);
    });
    await suite.test("send committed first remains readable after receiving is disabled", async () => {
      const cap = (await new BuddySupportQuery(first).capabilities("user_bob", "support_sql_sleep")).capability;
      await a.setReceiving("user_bob", "support_sql_sleep", { enabled: true, expected_revision: cap.permission_revision, operation_id: "sql_send_first_enable" });
      const keys = (["sleep", "focus"] as const).flatMap(domain => ["user_alice", "user_bob"].map(userId => ({ appId: "frogsleep", userId, domain })));
      let ready!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { ready = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const held = first.withFrogSleepBuddyCommandTransaction(keys, async () => {
        await a.send("user_alice", submission("sql_send_wins")); ready(); await gate;
      });
      await entered;
      const off = b.setReceiving("user_bob", "support_sql_sleep", { enabled: false, expected_revision: cap.permission_revision + 1, operation_id: "sql_send_first_off" });
      release(); await held; await off;
      assert.equal((await new BuddySupportQuery(second).history("user_bob", {})).notes.length, 1);
    });
    await suite.test("revocation committed first cannot be bypassed by a queued focus command", async () => {
      const keys = (["sleep", "focus"] as const).flatMap(domain => ["user_alice", "user_bob"].map(userId => ({ appId: "frogsleep", userId, domain })));
      let ready!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { ready = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const held = first.withFrogSleepBuddyCommandTransaction(keys, async () => {
        await first.updateFrogSleepEntity("focus_relationship", "frogsleep", "support_sql_focus", { status: "revoked" });
        ready(); await gate;
      });
      await entered;
      const pending = b.send("user_alice", submission("sql_after_revoke", "focus")).then(() => "sent", error => error.code);
      release(); await held;
      assert.equal(await pending, "BUDDY_SUPPORT_UNAVAILABLE");
    });
  } finally { await first.close(); await second.close(); }
});

async function setup(db: PostgresDatabase, command: BuddySupportCommand) {
  for (const userId of ["user_alice", "user_bob"]) {
    if (!await db.findAppUser("frogsleep", userId)) await db.insertAppUser({ id: `support_sql_${userId}`,
      appId: "frogsleep", userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
  }
  for (const domain of ["sleep", "focus"] as const) {
    const id = `support_sql_${domain}`, now = new Date().toISOString();
    if (!await db.findFrogSleepEntity(`${domain}_relationship`, "frogsleep", id)) await db.insertFrogSleepEntity({
      id, appId: "frogsleep", kind: `${domain}_relationship`, ownerUserId: "user_alice", partnerUserId: "user_bob",
      status: "accepted", payload: {}, createdAt: now, updatedAt: now });
    await db.updateFrogSleepEntity(`${domain}_relationship`, "frogsleep", id, { status: "accepted" });
    await command.enroll("user_alice", id);
    await command.setReceiving("user_bob", id, { enabled: true, expected_revision: 0, operation_id: `sql_enable_${domain}` });
  }
}
