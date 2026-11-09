import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { PersistentFileStore } from "../../src/infrastructure/files/persistent-file-store.ts";
import { FilePurgeService } from "../../src/infrastructure/files/file-purge.service.ts";
test("file purge is explicit, owner metadata protected, idempotent and recovers an abandoned lease", async () => {
  const dir = await mkdtemp(join(tmpdir(), "synthetic-purge-")),
    database = new InMemoryDatabase(),
    store = new PersistentFileStore(dir);
  let now = new Date("2026-11-04T10:00:00Z");
  const service = new FilePurgeService(database, store, () => now),
    key = "files/lighttick/synthetic.txt";
  try {
    await store.writeText(key, "Synthetic private file");
    await database.enqueueFilePurge("lighttick", "synthetic-owner", key);
    const old = (await database.claimFilePurges(1, now))[0];
    assert.equal((await service.runBatch()).removed, 0);
    now = new Date(now.getTime() + 60000);
    assert.equal((await service.runBatch()).removed, 1);
    await assert.rejects(store.readText(key), { code: "ENOENT" });
    await database.completeFilePurge(old);
    await database.enqueueFilePurge("lighttick", "synthetic-owner", key);
    assert.equal(
      (await service.runBatch()).removed,
      1,
      "already missing is success",
    );
    await store.writeText(key, "Referenced owner file");
    database.insertFile({
      id: "purge-fixture",
      appId: "lighttick",
      ownerUserId: "synthetic-owner",
      storageKey: key,
      mimeType: "text/plain",
      sizeBytes: 21,
      status: "CONFIRMED",
      createdAt: now.toISOString(),
    });
    await database.enqueueFilePurge("lighttick", "synthetic-owner", key);
    assert.equal((await service.runBatch()).retained, 1);
    assert.equal(await store.readText(key), "Referenced owner file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("purge rejects parent symlink escapes, never recurses and removes a leaf symlink without following its target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "synthetic-purge-path-")),
    outside = await mkdtemp(join(tmpdir(), "synthetic-purge-outside-")),
    store = new PersistentFileStore(dir);
  try {
    await writeFile(join(outside, "retained.txt"), "Outside retained");
    await symlink(outside, join(dir, "parent-link"));
    await assert.rejects(store.removeOwnedFile("parent-link/retained.txt"));
    await symlink(join(outside, "retained.txt"), join(dir, "leaf-link"));
    await store.removeOwnedFile("leaf-link");
    assert.equal(
      await readFile(join(outside, "retained.txt"), "utf8"),
      "Outside retained",
    );
    await mkdir(join(dir, "directory"));
    await assert.rejects(store.removeOwnedFile("directory"));
    await assert.rejects(store.removeOwnedFile("../escape"));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
