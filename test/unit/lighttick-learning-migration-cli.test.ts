import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLearningMigration } from "../../scripts/lighttick-learning-migration.ts";
import {courseMigrationFixture} from "../support/learning-route-migration-fixture.ts";
import { learningMigrationFixture } from "../support/native-learning-migration-fixture.ts";
test("migration CLI defaults to offline validation, never sends an implicit write and preserves reviewed remote command identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "synthetic-learning-cli-"));
  try {
    const f = learningMigrationFixture(),
      bundle = join(dir, "synthetic.json"),
      cookie = join(dir, "admin.cookie");
    await writeFile(bundle, JSON.stringify(f.bundle));
    await writeFile(cookie, "adminSession=synthetic-fixture", { mode: 0o600 });
    const calls: {
      url: string;
      init: RequestInit;
    }[] = [];
    const fetcher = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ code: "OK", data: { phase: "frozen" } });
    }) as typeof fetch;
    const basic = ["--bundle", bundle];
    assert.equal(
      (await runLearningMigration(basic, fetcher)).mode,
      "offline-dry-run",
    );
    assert.equal(calls.length, 0);
    await assert.rejects(
      runLearningMigration([...basic, "--action", "freeze"], fetcher),
      /require --apply/,
    );
    const remote = [
      ...basic,
      "--endpoint",
      "http://127.0.0.1:58631",
      "--cookie-file",
      cookie,
    ];
    await runLearningMigration(remote, fetcher);
    assert.match(calls[0].url, /\/preflight$/);
    await assert.rejects(
      runLearningMigration(
        [...remote, "--apply", "--action", "freeze"],
        fetcher,
      ),
      /reviewed/,
    );
    const apply = [
      ...remote,
      "--apply",
      "--action",
      "freeze",
      "--expected-digest",
      f.digest,
      "--request-id",
      "original-cli-freeze",
      "--base-revision",
      "0",
    ];
    await runLearningMigration(apply, fetcher);
    await runLearningMigration(apply, fetcher);
    assert.deepEqual(calls[1], calls[2]);
    assert.equal(
      (calls[1].init.headers as Record<string, string>)["Idempotency-Key"],
      "original-cli-freeze",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('offline CLI includes formal route relationship counts without any remote request',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'synthetic-course-cli-'));
 try{
  const bundle=join(dir,'course.json');await writeFile(bundle,JSON.stringify(courseMigrationFixture().bundle));
  const result=await runLearningMigration(['--bundle',bundle],(async()=>{throw Error('Dry-run must stay offline');}) as typeof fetch);
  assert.equal(result.counts?.routes,1);assert.equal(result.counts?.route_versions,2);assert.equal(result.counts?.route_links,1);assert.equal(result.counts?.work,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
