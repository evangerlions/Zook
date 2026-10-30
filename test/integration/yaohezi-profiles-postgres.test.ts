import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";

const connectionString = process.env.YAOHEZI_TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).hostname !== "127.0.0.1"
  || !new URL(connectionString).pathname.startsWith("/yaohezi_local_")) throw new Error("An isolated local database is required");

test("PostgreSQL explicit self bindings preserve subject identity and do not create health permissions", async () => {
  const database = await PostgresDatabase.create(connectionString, buildDefaultSeed(new DevelopmentPasswordHasher(), { includeYaohezi: true }));
  try {
    const store = database.getYaoheziProfileStore();
    const account = { appId: "yaohezi" as const, userId: "user_alice" };
    // Product membership must be separately established before a subject can be associated.
    await database.insertAppUser({ id: randomUUID(), ...account, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
    assert.deepEqual(await store.listSelfBindings(account), [], "Membership/login does not create a health subject");
    const command = { account, subjectId: randomUUID(), operationId: randomUUID(), confirmed: true };
    await assert.rejects(store.createSelfBinding({ ...command, confirmed: false }), { code: "YAOHEZI_EXPLICIT_CONFIRMATION_REQUIRED" });
    const created = await Promise.all(Array.from({ length: 6 }, () => store.createSelfBinding(command)));
    assert.ok(created.every(item => item.subjectId === command.subjectId && !item.healthAccessEstablished));
    assert.equal((await store.listSelfBindings(account)).length, 1);
    await assert.rejects(store.createSelfBinding({ ...command, subjectId: randomUUID() }), { code: "YAOHEZI_OPERATION_CONFLICT" });
    await assert.rejects(store.createSelfBinding({ ...command, operationId: randomUUID(), subjectId: randomUUID() }), { code: "YAOHEZI_SELF_BINDING_EXISTS" });
    await assert.rejects(store.listSelfBindings({ ...account, appId: "app_a" as "yaohezi" }), { code: "YAOHEZI_APP_SCOPE_MISMATCH" });
    await assert.rejects(store.listSelfBindings({ ...account, userId: "missing" }), { code: "YAOHEZI_MEMBERSHIP_REQUIRED" });
    const other = { ...account, userId: "user_bob" };
    await database.insertAppUser({ id: randomUUID(), ...other, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
    assert.deepEqual(await store.listSelfBindings(other), []);
    await assert.rejects(store.createSelfBinding({ ...command, account: other, operationId: randomUUID() }), { code: "YAOHEZI_SUBJECT_ASSOCIATION_UNAVAILABLE" });
    const otherSubject = randomUUID();
    const distinct = await store.createSelfBinding({ ...command, account: other, operationId: randomUUID(), subjectId: otherSubject });
    assert.equal(distinct.subjectId, otherSubject);
    assert.equal((await store.listSelfBindings(other)).length, 1);
    assert.equal((await store.listSelfBindings(account))[0].subjectId, command.subjectId);
    await database.updateAppUserStatus("yaohezi", other.userId, "BLOCKED");
    await assert.rejects(store.listSelfBindings(other), { code: "YAOHEZI_MEMBERSHIP_REQUIRED" });
    await assert.rejects(store.createSelfBinding({ ...command, account: other }), { code: "YAOHEZI_MEMBERSHIP_REQUIRED" });
    const blockedUser = { ...account, userId: "user_blocked" };
    await database.insertAppUser({ id: randomUUID(), ...blockedUser, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
    await assert.rejects(store.listSelfBindings(blockedUser), { code: "YAOHEZI_MEMBERSHIP_REQUIRED" });
    const reopened = await PostgresDatabase.create(connectionString);
    try { assert.equal((await reopened.getYaoheziProfileStore().listSelfBindings(account))[0].subjectId, command.subjectId); }
    finally { await reopened.close(); }
  } finally { await database.close(); }
});
