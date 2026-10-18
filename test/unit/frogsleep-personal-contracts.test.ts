import assert from "node:assert/strict";
import test from "node:test";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { FrogSleepPersonalSyncPageSchema, FrogSleepPersonalSyncStateSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { PersonalSyncService } from "../../src/modules/frogsleep/personal-sync/personal-sync.service.ts";

const ajv = new Ajv({ strict: false }); addFormats(ajv);
const page = ajv.compile(FrogSleepPersonalSyncPageSchema), state = ajv.compile(FrogSleepPersonalSyncStateSchema);
test("personal sync actual responses and client JSON samples satisfy generated canonical schemas", async () => {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: seed => new InMemoryDatabase(seed) });
  await runtime.services.authService.login({ appId: "frogsleep", account: "alice@example.com", password: "Password1234" });
  const service = new PersonalSyncService(runtime.database.getPersonalSyncRepository());
  await service.write("user_alice","sleep_report","schema-report",{ snapshot_id:"schema-report",schema_version:"1",recorded_at:"2026-10-11T08:00:00.000Z",data:{sleep_minutes:420}},false);
  assert.equal(state(await service.state("user_alice")),true,JSON.stringify(state.errors));
  assert.equal(page(await service.page("user_alice","restore",50)),true,JSON.stringify(page.errors));
  const fixture = JSON.parse(await readFile(new URL("../fixtures/frogsleep-personal-sync.json",import.meta.url),"utf8"));
  assert.equal(page(fixture.restore),true,JSON.stringify(page.errors));
  assert.equal(page(fixture.changes),true,JSON.stringify(page.errors));
  assert.equal(state(fixture.state),true,JSON.stringify(state.errors));
});
