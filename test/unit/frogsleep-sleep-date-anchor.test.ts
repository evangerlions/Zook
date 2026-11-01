import assert from "node:assert/strict";
import test from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { FrogSleepSharedSleepSessionRequestSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { FrogSleepSleepBuddyService } from "../../src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";
enableFrogSleepBuddyCapabilities();

test("iOS legacy timestamp and Android calendar day begin the same shared night", async () => {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: seed => new InMemoryDatabase(seed) });
  const now = new Date().toISOString();
  await app.database.insertFrogSleepEntity({ id: "night-anchor", appId: "frogsleep", kind: "sleep_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: "active", payload: {}, createdAt: now, updatedAt: now });
  const service = new FrogSleepSleepBuddyService(app.database);
  await app.services.appRegistryService.ensureMembership("frogsleep", "user_alice");
  const token = (await app.services.authService.issueSession("user_alice", "frogsleep")).accessToken;
  const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/shared-sessions",
    headers: { authorization: `Bearer ${token}` }, requestId: "legacy_date_anchor",
    body: { relationship_id: "night-anchor", date_anchor: "2026-10-18T22:45:00.000Z" } } as never);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  const ios = response.body.data;
  const android = await service.beginSession("user_bob", "night-anchor", "2026-10-18");
  assert.equal(ios.session_id, android.session_id);
  assert.equal(ios.date_anchor, "2026-10-18");
  const offset = await service.beginSession("user_alice", "night-anchor", "2026-10-18T00:45:00+14:00");
  assert.equal(offset.session_id, ios.session_id, "the written calendar date is retained without UTC conversion");
});

test("invalid night dates reject through the service without persisting a shared night", async () => {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: seed => new InMemoryDatabase(seed) });
  const now = new Date().toISOString();
  await app.database.insertFrogSleepEntity({ id: "invalid-night-anchor", appId: "frogsleep", kind: "sleep_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: "active", payload: {}, createdAt: now, updatedAt: now });
  const service = new FrogSleepSleepBuddyService(app.database);
  for (const input of ["2026-02-31", "not-a-date", "2026-13-01", "2026-10-18garbage"]) {
    await assert.rejects(service.beginSession("user_alice", "invalid-night-anchor", input), { statusCode: 400, code: "REQ_INVALID_BODY" });
  }
  const records = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_session", limit: 100 });
  assert.equal(records.length, 0);
});

test("shared sleep request contract accepts calendar days and legacy timestamps on both field names", () => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(FrogSleepSharedSleepSessionRequestSchema);
  for (const field of ["date_anchor", "dateAnchor"]) {
    for (const date of ["2026-10-18", "2026-10-18T22:45:00.000Z", "2026-10-18T00:45:00+14:00"]) {
      assert.equal(validate({ relationship_id: "night-anchor", [field]: date }), true, JSON.stringify(validate.errors));
    }
    for (const date of ["2026-02-31", "2026-13-01", "not-a-date"]) {
      assert.equal(validate({ relationship_id: "night-anchor", [field]: date }), false);
    }
  }
});
