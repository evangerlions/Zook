import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import type { FrogSleepEntityRecord } from "../../src/shared/types.ts";

test("FrogSleep device persistence is app and owner scoped", () => {
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const createdAt = "2026-04-01T00:00:00.000Z";

  const first = database.upsertFrogSleepDevice({
    id: "device_a",
    appId: "frogsleep",
    userId: "user_alice",
    platform: "ios",
    pushToken: "push_token_1",
    appVersion: "1.0.0",
    timezone: "Asia/Shanghai",
    pushEnabled: true,
    createdAt,
    updatedAt: createdAt,
  });
  const second = database.upsertFrogSleepDevice({
    ...first,
    id: "device_b",
    appVersion: "1.1.0",
    updatedAt: "2026-04-01T00:01:00.000Z",
  });

  assert.equal(second.id, "device_a");
  assert.equal(second.appVersion, "1.1.0");
  assert.equal(database.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice" }).length, 1);
  assert.equal(database.listFrogSleepDevices({ appId: "app_a", userId: "user_alice" }).length, 0);

  const deleted = database.deleteFrogSleepDevice("frogsleep", "user_alice", "device_a");
  assert.equal(deleted?.pushEnabled, false);
  assert.equal(database.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice" }).length, 0);
  assert.equal(database.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice", includeDeleted: true }).length, 1);
});

test("FrogSleep entity persistence supports app isolation and lookup indexes", () => {
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const invite: FrogSleepEntityRecord = {
    id: "sleep_invite_1",
    appId: "frogsleep",
    kind: "sleep_invite",
    ownerUserId: "user_alice",
    partnerUserId: "user_bob",
    status: "pending",
    code: "ABC123",
    token: "token_abc",
    payload: { role: "guardian" },
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
  const focusSession: FrogSleepEntityRecord = {
    id: "focus_session_1",
    appId: "frogsleep",
    kind: "focus_session",
    ownerUserId: "user_alice",
    status: "completed",
    startsAt: "2026-04-01T10:00:00.000Z",
    endsAt: "2026-04-01T10:25:00.000Z",
    payload: { minutes: 25 },
    createdAt: "2026-04-01T10:26:00.000Z",
    updatedAt: "2026-04-01T10:26:00.000Z",
  };

  database.insertFrogSleepEntity(invite);
  database.insertFrogSleepEntity({ ...invite, id: "other_app_invite", appId: "app_a", code: "OTHER", token: "other" });
  database.insertFrogSleepEntity(focusSession);

  assert.equal(database.findFrogSleepEntityByCode("sleep_invite", "frogsleep", "ABC123")?.id, "sleep_invite_1");
  assert.equal(database.findFrogSleepEntityByToken("sleep_invite", "frogsleep", "token_abc")?.id, "sleep_invite_1");
  assert.equal(database.findFrogSleepEntityByCode("sleep_invite", "app_a", "ABC123"), undefined);

  const focusSessions = database.listFrogSleepEntities({
    appId: "frogsleep",
    kind: "focus_session",
    ownerUserId: "user_alice",
    startsAtFromIso: "2026-04-01T00:00:00.000Z",
    startsAtToIso: "2026-04-02T00:00:00.000Z",
  });
  assert.deepEqual(focusSessions.map((item) => item.id), ["focus_session_1"]);

  const updated = database.updateFrogSleepEntity("sleep_invite", "frogsleep", "sleep_invite_1", {
    status: "accepted",
    payload: { role: "guardian", accepted: true },
  });
  assert.equal(updated?.status, "accepted");
  assert.deepEqual(updated?.payload, { role: "guardian", accepted: true });
});

test("FrogSleep persistence rejects duplicate live sleep relationship pairs", () => {
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const createdAt = "2026-04-01T00:00:00.000Z";
  const relationship: FrogSleepEntityRecord = {
    id: "sleep_relationship_1",
    appId: "frogsleep",
    kind: "sleep_relationship",
    ownerUserId: "user_alice",
    partnerUserId: "user_bob",
    status: "active",
    payload: {},
    createdAt,
    updatedAt: createdAt,
  };

  database.insertFrogSleepEntity(relationship);

  assert.throws(
    () => database.insertFrogSleepEntity({
      ...relationship,
      id: "sleep_relationship_2",
      ownerUserId: "user_bob",
      partnerUserId: "user_alice",
      status: "paused",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

test("FrogSleep persistence rejects duplicate live focus relationship pairs", () => {
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const createdAt = "2026-04-01T00:00:00.000Z";
  const relationship: FrogSleepEntityRecord = {
    id: "focus_relationship_1",
    appId: "frogsleep",
    kind: "focus_relationship",
    ownerUserId: "user_alice",
    partnerUserId: "user_bob",
    status: "pending",
    payload: {},
    createdAt,
    updatedAt: createdAt,
  };

  database.insertFrogSleepEntity(relationship);

  assert.throws(
    () => database.insertFrogSleepEntity({
      ...relationship,
      id: "focus_relationship_2",
      ownerUserId: "user_bob",
      partnerUserId: "user_alice",
      status: "accepted",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});
