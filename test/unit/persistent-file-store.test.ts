import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONTAINER_APP_RUN_DATA_ROOT,
  HOST_APP_RUN_DATA_ROOT,
  PersistentFileStore,
  assertPersistentFileStoreReady,
  resolvePersistentFileStorageRoot,
} from "../../src/infrastructure/files/persistent-file-store.ts";

test("persistent file store writes and reads text content", async () => {
  const root = mkdtempSync(join(tmpdir(), "zook-file-store-"));
  const store = new PersistentFileStore(root);

  const written = await store.writeText(
    "client-log-uploads/app_a/hello.txt",
    "hello-world",
  );
  const readBack = await store.readText(written.filePath);

  assert.match(written.filePath, /client-log-uploads\/app_a\/hello\.txt$/);
  assert.equal(written.sizeBytes, 11);
  assert.equal(readBack, "hello-world");
});

test("persistent file store smoke test writes random content and reads it back", async () => {
  const root = mkdtempSync(join(tmpdir(), "zook-file-smoke-"));
  await assert.doesNotReject(() => assertPersistentFileStoreReady(root));
});

test("persistent file store smoke test tolerates concurrent startup checks", async () => {
  const root = mkdtempSync(join(tmpdir(), "zook-file-smoke-concurrent-"));
  await assert.doesNotReject(() =>
    Promise.all(
      Array.from({ length: 8 }, () => assertPersistentFileStoreReady(root)),
    ),
  );
});

test("persistent storage root resolves to host path outside containers and container path inside containers", () => {
  const previous = process.env.ZOOK_APP_RUN_DATA_ROOT;
  delete process.env.ZOOK_APP_RUN_DATA_ROOT;
  try {
    assert.equal(resolvePersistentFileStorageRoot(false), HOST_APP_RUN_DATA_ROOT);
    assert.equal(
      resolvePersistentFileStorageRoot(true),
      CONTAINER_APP_RUN_DATA_ROOT,
    );
  } finally {
    if (previous !== undefined) {
      process.env.ZOOK_APP_RUN_DATA_ROOT = previous;
    }
  }
});

test("persistent storage root can be overridden for local integration runs", () => {
  const previous = process.env.ZOOK_APP_RUN_DATA_ROOT;
  const root = mkdtempSync(join(tmpdir(), "zook-file-root-override-"));
  process.env.ZOOK_APP_RUN_DATA_ROOT = root;
  try {
    assert.equal(resolvePersistentFileStorageRoot(false), root);
    assert.equal(resolvePersistentFileStorageRoot(true), root);
  } finally {
    if (previous === undefined) {
      delete process.env.ZOOK_APP_RUN_DATA_ROOT;
    } else {
      process.env.ZOOK_APP_RUN_DATA_ROOT = previous;
    }
  }
});
