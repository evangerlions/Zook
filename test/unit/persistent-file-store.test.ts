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

  const written = await store.writeText("client-log-uploads/app_a/hello.txt", "hello-world");
  const readBack = await store.readText(written.filePath);

  assert.match(written.filePath, /client-log-uploads\/app_a\/hello\.txt$/);
  assert.equal(written.sizeBytes, 11);
  assert.equal(readBack, "hello-world");
});

test("persistent file store smoke test writes random content and reads it back", async () => {
  const root = mkdtempSync(join(tmpdir(), "zook-file-smoke-"));
  await assert.doesNotReject(() => assertPersistentFileStoreReady(root));
});

test("persistent storage root resolves to host path outside containers and container path inside containers", () => {
  assert.equal(resolvePersistentFileStorageRoot(false), HOST_APP_RUN_DATA_ROOT);
  assert.equal(resolvePersistentFileStorageRoot(true), CONTAINER_APP_RUN_DATA_ROOT);
});

test("persistent file store blocks path traversal outside the root", async () => {
  const root = mkdtempSync(join(tmpdir(), "zook-file-store-"));
  const store = new PersistentFileStore(root);

  await assert.rejects(() => store.writeText("../../etc/passwd", "nope"));
});
