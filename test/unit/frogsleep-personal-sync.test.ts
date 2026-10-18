import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { PersonalSyncService } from "../../src/modules/frogsleep/personal-sync/personal-sync.service.ts";
import { verifyPersonalWrites, verifyPersonalPages, verifyPersonalDelete } from "../helpers/frogsleep-personal-sync-contract.ts";

async function fixture() {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: seed => new InMemoryDatabase(seed) });
  for (const account of ["alice@example.com","bob@example.com"]) await runtime.services.authService.login({ appId: "frogsleep", account, password: "Password1234" });
  return runtime;
}
test("personal writes are concurrent idempotent, revision checked and account scoped", async () => { await verifyPersonalWrites((await fixture()).database.getPersonalSyncRepository()); });
test("restore crosses 500 records and retains a fixed view while changes are committed", async () => { await verifyPersonalPages((await fixture()).database.getPersonalSyncRepository()); });
test("delete wins over stale retries and preferences require revisions", async () => { await verifyPersonalDelete((await fixture()).database.getPersonalSyncRepository()); });
test("app account deletion clears history and invalidates epochs without deleting another app", async () => {
  const runtime = await fixture(), db = runtime.database, repo = db.getPersonalSyncRepository();
  const service = new PersonalSyncService(repo), old = await service.state("user_alice");
  await service.write("user_alice", "sleep_report", "old-account", { minutes: 300 }, false);
  await db.insertFrogSleepEntity({ id: "another-app-record", kind: "sleep_report_snapshot", appId: "app_a", ownerUserId: "user_alice", payload: { keep: true }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await runtime.services.authService.deleteCurrentAppAccount({ appId: "frogsleep", userId: "user_alice", confirmation: "DELETE" });
  await db.updateAppUserStatus("frogsleep","user_alice","ACTIVE");
  const rebuilt = await service.state("user_alice"); assert.notEqual(old.sync_epoch, rebuilt.sync_epoch); assert.equal(rebuilt.sequence, 0);
  assert.equal(db.listFrogSleepEntities({ appId: "app_a",kind: "sleep_report_snapshot" }).length, 1);
  await assert.rejects(service.write("user_alice","sleep_report","old-account",{},false,{ epoch: old.sync_epoch }), { code: "FROGSLEEP_SYNC_EPOCH_MISMATCH" });
  await assert.rejects(service.write("user_alice","sleep_report","old-account",{},false), { code: "FROGSLEEP_SYNC_EPOCH_MISMATCH" });
  await service.write("user_alice","sleep_report","new-account",{},false,{ epoch: rebuilt.sync_epoch });
});
test("sync gates disable writes while retaining recovery and deletion history", async () => {
  const runtime = await fixture(); const service = new PersonalSyncService(runtime.database.getPersonalSyncRepository());
  await service.write("user_alice","sleep_report","gate",{},false);
  process.env.FROGSLEEP_PERSONAL_SYNC_WRITE_ENABLED = "false";
  try { await assert.rejects(service.write("user_alice","sleep_report","gated",{},false), { code: "FROGSLEEP_SYNC_DISABLED" }); assert.equal((await service.get("user_alice","sleep_report","gate")).revision,1); }
  finally { delete process.env.FROGSLEEP_PERSONAL_SYNC_WRITE_ENABLED; }
});
test("private API rejects forged owner and exposes typed recovery and report detail/delete", async () => {
  const runtime = await fixture(); const login = await runtime.services.authService.login({ appId: "frogsleep", account: "alice@example.com", password: "Password1234" });
  const call = (method: string,path: string,body?: unknown,headers: Record<string,string> = {}) => runtime.app.handle({ method,path: `/api/v1/frogsleep/product-data${path}`,body,headers: { authorization: `Bearer ${login.accessToken}`, ...headers }, requestId: "personal-api" } as never);
  const report = { snapshot_id: "api-report",schema_version: "1",recorded_at: "2026-10-11T08:00:00Z",data: { minutes: 400 } };
  assert.equal((await call("POST","/sleep-reports",{...report,owner_user_id:"user_bob"})).statusCode,403);
  const created = await call("POST","/sleep-reports",report,{"idempotency-key":"api-create"}); assert.equal(created.statusCode,200);
  assert.equal((await call("GET","/sleep-reports/api-report")).body.data.revision,1);
  const restore = await call("GET","/personal-sync/restore"); assert.equal(restore.body.data.items.length,1);
  const removed = await call("DELETE","/sleep-reports/api-report",undefined,{"if-match":"1","idempotency-key":"api-delete"});
  assert.equal(removed.statusCode,200);
  assert.equal(removed.body.data.resource.deleted,true);
  assert.equal(removed.body.data.resource.revision,2);
  assert.equal(removed.body.data.resource.sync_epoch,removed.body.sync_epoch);
  assert.equal((await call("POST","/sleep-reports",report)).statusCode,410);
  assert.equal((await call("GET","/sleep-reports/api-report")).statusCode,404);
});

test("private report browsing preserves business date order and preference GET compatibility", async () => {
  const runtime=await fixture();
  const login=await runtime.services.authService.login({appId:"frogsleep",account:"alice@example.com",password:"Password1234"});
  const call=(method:string,path:string,body?:unknown,headers:Record<string,string>={})=>runtime.app.handle({method,path:`/api/v1/frogsleep/product-data${path}`,body,headers:{authorization:`Bearer ${login.accessToken}`,...headers}} as never);
  const empty=await call("GET","/progress/report_preferences"); assert.equal(empty.statusCode,200);assert.equal(empty.body.data.progress,null);
  for(const [id,date] of [["newer","2026-10-11"],["older","2026-10-10"]]) {
    const saved=await call("POST","/sleep-reports",{snapshot_id:id,schema_version:"1",recorded_at:`${date}T08:00:00Z`,data:{}});assert.equal(saved.statusCode,200);
  }
  const listed=await call("GET","/sleep-reports");assert.deepEqual(listed.body.data.sleep_reports.map((r:any)=>r.id),["newer","older"]);
  assert.equal((await call("PUT","/progress/report_preferences",{schema_version:"1",state:{week_start:"monday"}})).statusCode,200);
  assert.equal((await call("PATCH","/progress/report_preferences",{schema_version:"1",state:{week_start:"sunday"}})).statusCode,409);
  assert.equal((await call("PATCH","/progress/report_preferences",{schema_version:"1",state:{week_start:"sunday"}},{"if-match":'"1"'})).statusCode,200);
  assert.equal((await call("DELETE","/sleep-reports/newer",undefined,{"if-match":'"1'})).statusCode,400);
});
