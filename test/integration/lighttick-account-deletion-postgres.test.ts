import {LIGHTTICK_OWNED_TABLES} from "../../src/infrastructure/database/postgres/postgres-lighttick-owned-tables.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentFileStore } from "../../src/infrastructure/files/persistent-file-store.ts";
import { StorageService } from "../../src/infrastructure/files/storage.service.ts";
import { FilePurgeService } from "../../src/infrastructure/files/file-purge.service.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { KnowledgeService } from "../../src/modules/lighttick/knowledge/knowledge.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable synthetic localhost database required");
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
}
test("platform account deletion holds the LightTick owner gate, purges all product history atomically and preserves another owner", async () => {
  const database = await PostgresDatabase.create(dsn),
    pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    owner = { appId: "lighttick" as const, userId: "delete-pg-" + process.pid },
    other = { ...owner, userId: "keep-pg-" + process.pid };
  const dir = await mkdtemp(join(tmpdir(), "synthetic-delete-pg-")),
    store = new PersistentFileStore(dir);
  const k = new KnowledgeService(repo),
    native = new NativeLearningService(repo, true),
    body = {
      base_revision: 0,
      kind: "knowledge",
      title: "Synthetic retained",
      body: "Private text",
      tags: [],
      sources: [],
    };
  try {
    const schema=(await pool.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'zook_lighttick_%' AND column_name IN ('app_id','user_id') GROUP BY table_name HAVING count(*)=2")).rows.map(r=>r.table_name).sort();
    assert.deepEqual(schema,[...LIGHTTICK_OWNED_TABLES.map(t=>'zook_lighttick_'+t),'zook_lighttick_local_claims'].sort(),'new owner tables must join all deletion paths');
    const seed = buildDefaultSeed(undefined, { includeLightTick: true }),
      alice = seed.users!.find((u) => u.id === "user_alice")!;
    await database.insertUser({
      ...alice,
      id: owner.userId,
      email: owner.userId + "@example.com",
      phone: undefined,
    });
    await database.insertAppUser({
      id: "member-" + owner.userId,
      appId: "lighttick",
      userId: owner.userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
    const file = await new StorageService(database).storeOwnerText(
      store,
      owner,
      "synthetic.txt",
      "Synthetic deleted file",
      "delete-pg-file",
    );
    await k.mutate(
      owner,
      "knowledge-delete",
      "save",
      body,
      "delete-pg-original",
    );
    await k.mutate(other, "knowledge-keep", "save", body, "keep-pg-original");
    await native.saveCollection(
      owner,
      "delete-course",
      { base_revision: 0, title: "Delete course", archived: false },
      "delete-collection",
    );
    const lesson = await native.publish(
      owner,
      "lesson-delete-pg",
      {
        base_revision: 0,
        collection_id: "delete-course",
        number: 1,
        title: "Delete lesson",
        content: "Synthetic private content",
        references: "",
        source_url: "",
      },
      "delete-publication",
    );
    await native.privateCommand(
      owner,
      lesson.id,
      {
        action: "save",
        content_version: lesson.content_version,
        base_revision: 0,
        notes: "Private history",
        answers: [],
      },
      "delete-private-notes",
    );
    await assert.rejects(
      database.withAppUserDataTransaction(
        owner.appId,
        owner.userId,
        async () => {
          await database.deleteAppUserRuntimeData(owner.appId, owner.userId);
          throw Error("Crash before commit");
        },
      ),
    );
    assert.ok(await repo.knowledge.get(owner, "knowledge-delete"));
    assert.ok(
      await repo.getNativePrivateState(
        owner,
        lesson.id,
        lesson.content_version,
      ),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM zook_owner_file_purges WHERE user_id=$1",
          [owner.userId],
        )
      ).rows[0].n,
      0,
      "failed deletion rolls back its file purge outbox",
    );
    const locked = signal(),
      release = signal(),
      writing = repo.transaction(owner, async () => {
        locked.resolve();
        await release.promise;
      });
    await locked.promise;
    let deleted = false;
    const deletion = database.withAppUserDataTransaction(
      owner.appId,
      owner.userId,
      async () => {
        await database.deleteAppUserRuntimeData(owner.appId, owner.userId);
        deleted = true;
      },
    );
    try {
      const deadline=Date.now()+2000;let waiting=false;
      while(Date.now()<deadline){waiting=Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%hashtextextended%'")).rows[0].n)>0;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
      assert.equal(waiting,true,'platform deletion must actually wait on the owner gate');assert.equal(deleted,false);
    }finally{release.resolve();}
    await writing;
    await deletion;
    assert.equal(
      await repo.knowledge.get(owner, "knowledge-delete"),
      undefined,
    );
    assert.equal(
      (await repo.knowledge.history(owner, "knowledge-delete", 99, 10)).length,
      0,
    );
    assert.ok(
      Object.values(await repo.getNativeLearningCounts(owner)).every(
        (n) => n === 0,
      ),
    );
    assert.equal(
      await repo.getOperation(owner, "delete-pg-original"),
      undefined,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM zook_owner_file_purges WHERE user_id=$1",
          [owner.userId],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      await store.readText(file.storage_key),
      "Synthetic deleted file",
      "physical deletion is durable worker work, not filesystem IO in the owner transaction",
    );
    const abandoned = (await database.claimFilePurges(1, new Date()))[0];
    assert.equal(abandoned.storageKey, file.storage_key);
    assert.equal(
      (await new FilePurgeService(database, store).runBatch()).removed,
      0,
    );
    assert.equal(
      (
        await new FilePurgeService(
          database,
          new PersistentFileStore(dir),
          () => new Date(Date.now() + 60000),
        ).runBatch()
      ).removed,
      1,
    );
    await database.completeFilePurge(abandoned);
    await assert.rejects(store.readText(file.storage_key), { code: "ENOENT" });
    assert.ok(await repo.knowledge.get(other, "knowledge-keep"));
    assert.equal(await repo.getLearningAuthority(owner), undefined);
  } finally {
    await repo.deleteOwnerData(owner);
    await repo.deleteOwnerData(other);
    await pool.query("DELETE FROM zook_app_users WHERE user_id=$1", [
      owner.userId,
    ]);
    await pool.query("DELETE FROM zook_users WHERE id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_owner_file_purges WHERE user_id=$1", [
      owner.userId,
    ]);
    await pool.end();
    await database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
