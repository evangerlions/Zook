import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function fixture() {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const login = await runtime.services.authService.login({ appId: "frogsleep",
    account: "alice@example.com", password: "Password1234" });
  const call = (body: unknown, authenticated = true) => runtime.app.handle({ method: "POST",
    path: "/api/v1/frogsleep/account/upgrade", body,
    headers: authenticated ? { authorization: `Bearer ${login.accessToken}` } : {} } as never);
  return { runtime, call };
}

test("cloud guest transfer cannot claim another device's records or report false success", async () => {
  const { runtime, call } = await fixture();
  const record = { id: "guest-private-report", appId: "frogsleep", kind: "sleep_report_snapshot" as const,
    ownerUserId: "guest:guessed-device", payload: { data: { private: "unchanged" } },
    createdAt: "2026-10-16T08:00:00Z", updatedAt: "2026-10-16T08:00:00Z" };
  await runtime.database.insertFrogSleepEntity(record);
  for (const device of ["guessed-device", "unknown-device"]) {
    const response = await call({ guest_device_id: device });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "FROGSLEEP_GUEST_UPGRADE_UNSUPPORTED");
    assert.equal(response.body.migrated_data_count, undefined);
  }
  assert.deepEqual(await runtime.database.listFrogSleepEntities({ appId: "frogsleep",
    ownerUserId: "guest:guessed-device" }), [record]);
  assert.equal((await runtime.database.listFrogSleepEntities({ appId: "frogsleep",
    ownerUserId: "user_alice" })).length, 0);
});

test("reserved guest transfer still requires authentication and a valid device ID", async () => {
  const { call } = await fixture();
  assert.equal((await call({ guest_device_id: "device" }, false)).statusCode, 401);
  for (const body of [{}, { guest_device_id: "   " }, { guest_device_id: 123 }, { guest_device_id: null }]) {
    const response = await call(body);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "REQ_INVALID_BODY");
  }
});
