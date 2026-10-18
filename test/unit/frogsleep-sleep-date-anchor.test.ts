import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { FrogSleepSleepBuddyService } from "../../src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";
import { sleepDateAnchor } from "../../src/modules/frogsleep/sleep-buddy/sleep-date-anchor.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";
enableFrogSleepBuddyCapabilities();

test("iOS legacy timestamp and Android calendar day begin the same shared night", async () => {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: seed => new InMemoryDatabase(seed) });
  const now = new Date().toISOString();
  await app.database.insertFrogSleepEntity({ id: "night-anchor", appId: "frogsleep", kind: "sleep_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: "active", payload: {}, createdAt: now, updatedAt: now });
  const service = new FrogSleepSleepBuddyService(app.database);
  const ios = await service.beginSession("user_alice", "night-anchor", "2026-10-18T22:45:00.000Z");
  const android = await service.beginSession("user_bob", "night-anchor", "2026-10-18");
  assert.equal(ios.session_id, android.session_id);
  assert.equal(ios.date_anchor, "2026-10-18");
});

test("invalid night dates are rejected instead of splitting or inventing a shared night", () => {
  for (const input of ["2026-02-31", "not-a-date", "2026-13-01"]) assert.throws(() => sleepDateAnchor(input));
  assert.equal(sleepDateAnchor("2026-10-18"), "2026-10-18");
});
