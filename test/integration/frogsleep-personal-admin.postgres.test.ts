import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PersonalSyncService } from "../../src/modules/frogsleep/personal-sync/personal-sync.service.ts";
import { verifyPersonalWrites, verifyPersonalPages, verifyPersonalDelete } from "../helpers/frogsleep-personal-sync-contract.ts";

const url = process.env.FROGSLEEP_TEST_DATABASE_URL;
if (!url) throw new Error("FROGSLEEP_TEST_DATABASE_URL must point to a disposable database.");
test("PostgreSQL private sync, migration, commit order and admin metadata", async suite => {
  const a = await PostgresDatabase.create(url, buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const b = await PostgresDatabase.create(url, buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const sql = new Client({ connectionString: url }); await sql.connect();
  try {
    for (const userId of ["user_alice","user_bob"]) if (!(await a.findAppUser("frogsleep", userId))) await a.insertAppUser({ id: `pg_personal_${userId}`, appId: "frogsleep", userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await suite.test("concurrent first upload, lost acknowledgement and account-scoped IDs", async () => {
      const sa = new PersonalSyncService(a.getPersonalSyncRepository()), sb = new PersonalSyncService(b.getPersonalSyncRepository());
      const results = await Promise.all(Array.from({ length: 12 }, (_,i) => (i%2 ? sa : sb).write("user_alice","sleep_report","cross-process",{value:1},false,{operationKey:"cross-process-key"})));
      assert.equal(new Set(results.map(r => r.sequence)).size,1);
      await assert.rejects(sql.query(`INSERT INTO zook_frogsleep_personal_versions(app_id,user_id,kind,resource_id,sequence,document)
        SELECT app_id,user_id,kind,resource_id,sequence+1000,document FROM zook_frogsleep_personal_versions WHERE user_id='user_alice' AND resource_id='cross-process' LIMIT 1`), { code: '23505', constraint: 'uq_frogsleep_personal_resource_revision' });
      await verifyPersonalWrites(a.getPersonalSyncRepository());
    });
    await suite.test("more than 500 reports, fixed restore views and invalid cursors", async () => { await verifyPersonalPages(a.getPersonalSyncRepository()); });
    await suite.test("tombstones, conflicts, shared JSON samples and rollback", async () => {
      await verifyPersonalDelete(a.getPersonalSyncRepository());
      const before = await new PersonalSyncService(a.getPersonalSyncRepository()).state("user_alice");
      await assert.rejects(a.getPersonalSyncRepository().run("user_alice", async tx => {
        await tx.commit({ id:"rollback",kind:"sleep_report",revision:1,sequence:tx.state.sequence+1,deleted:false,data:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString() },"rollback-key","rollback-digest"); throw new Error("rollback");
      }));
      const after = await new PersonalSyncService(b.getPersonalSyncRepository()).state("user_alice"); assert.equal(after.sequence,before.sequence);
    });
    await suite.test("account lock holds until commit so a later checkpoint cannot skip an uncommitted event", async () => {
      let locked!: () => void, release!: () => void;
      const ready = new Promise<void>(resolve => { locked=resolve; }), gate = new Promise<void>(resolve => { release=resolve; });
      const first = a.getPersonalSyncRepository().run("user_alice",async tx => {
        locked(); await gate; const sequence=tx.state.sequence+1;
        await tx.commit({id:"commit-first",kind:"sleep_report",revision:1,sequence,deleted:false,data:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString()},"commit-first","one"); return sequence;
      });
      await ready;
      const second = new PersonalSyncService(b.getPersonalSyncRepository()).write("user_alice","sleep_report","commit-second",{},false);
      release(); const [f,s] = await Promise.all([first,second]); assert.equal(s.sequence,f+1);
    });
    await suite.test("admin queries page all records and omit private report and device payloads", async () => {
      const store = a.getFrogSleepAdminStore(); const summary = await store.summary(); assert.ok(summary.reports>530);
      const page = await store.search({resource:"reports",page:6,limit:100,userId:"user_alice"}); assert.ok(page.items.length>0);
      assert.ok(page.items.every(r => r.user_id==="user_alice")); assert.ok(!JSON.stringify(page).includes('"data"'));
      await a.upsertFrogSleepDevice({ id:"admin-secret-device",appId:"frogsleep",userId:"user_alice",platform:"ios",pushToken:"SUPER_PRIVATE_TOKEN",pushEnabled:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() });
      assert.ok(!JSON.stringify(await store.search({resource:"devices",page:1,limit:25})).includes("SUPER_PRIVATE_TOKEN"));
    });
    await suite.test("legacy identical reports canonicalize, differing content remains conflict history; migrations replay", async () => {
      for (const [id,minutes] of [["legacy-a",300],["legacy-b",300],["legacy-c",400]] as const) await a.insertFrogSleepEntity({ id,appId:"frogsleep",kind:"sleep_report_snapshot",ownerUserId:"user_bob",status:"active",payload:{snapshot_id:"legacy-day",schema_version:"1",recorded_at:"2026-10-11T08:00:00.000Z",data:{minutes}},createdAt:"2026-10-11T08:00:00.000Z",updatedAt:"2026-10-11T08:00:00.000Z" });
      const migration = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/071_frogsleep_personal_sync_backfill.sql",import.meta.url),"utf8");
      for (let i=0;i<2;i++) { await sql.query("BEGIN"); await sql.query(migration); await sql.query("COMMIT"); }
      const aliases=(await sql.query("SELECT old_id,resource_id,conflicting FROM zook_frogsleep_personal_legacy_aliases WHERE user_id='user_bob' ORDER BY old_id")).rows;
      assert.equal(aliases[0].resource_id,aliases[1].resource_id); assert.notEqual(aliases[1].resource_id,aliases[2].resource_id); assert.equal(aliases[2].conflicting,true);
      const page=await new PersonalSyncService(b.getPersonalSyncRepository()).page("user_bob","restore",100); assert.equal(page.items.filter(r => r.data.snapshot_id==='legacy-day').length,2);
    });
    await suite.test("app deletion is scoped, old epochs and no-epoch uploads are rejected after rebuild", async () => {
      const old=await new PersonalSyncService(a.getPersonalSyncRepository()).state("user_alice");
      await a.insertFrogSleepEntity({id:"personal-other-app",appId:"app_a",kind:"sleep_report_snapshot",ownerUserId:"user_alice",payload:{keep:true},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      const competition = await Promise.allSettled([
        new PersonalSyncService(b.getPersonalSyncRepository()).write("user_alice","sleep_report","racing-delete",{},false),
        a.withExclusiveSession(async () => { await a.deleteAppUserRuntimeData("frogsleep","user_alice"); await a.updateAppUserStatus("frogsleep","user_alice","DELETED"); }),
      ]);
      assert.equal(competition[1].status,"fulfilled");
      assert.equal((await sql.query("SELECT count(*)::int n FROM zook_frogsleep_personal_versions WHERE user_id='user_alice'")).rows[0].n,0);
      assert.ok(await a.findFrogSleepEntity("sleep_report_snapshot","app_a","personal-other-app"));
      assert.ok((await new PersonalSyncService(b.getPersonalSyncRepository()).page("user_bob","restore",100)).items.length>0);
      await a.updateAppUserStatus("frogsleep","user_alice","ACTIVE");
      const service=new PersonalSyncService(b.getPersonalSyncRepository()), fresh=await service.state("user_alice"); assert.notEqual(old.sync_epoch,fresh.sync_epoch); assert.equal(fresh.sequence,0);
      await assert.rejects(service.write("user_alice","sleep_report","resurrect",{},false,{epoch:old.sync_epoch}),{code:"FROGSLEEP_SYNC_EPOCH_MISMATCH"});
      await assert.rejects(service.write("user_alice","sleep_report","resurrect",{},false),{code:"FROGSLEEP_SYNC_EPOCH_MISMATCH"});
      await service.write("user_alice","sleep_report","fresh",{},false,{epoch:fresh.sync_epoch});
    });
  } finally { await sql.end(); await a.close(); await b.close(); }
});
