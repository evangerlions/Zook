import test from "node:test";
import assert from "node:assert/strict";
import {
  isContainerRuntime,
  resolveRuntimeDatabaseUrl,
  resolvePersistentFileStorageRoot,
  resolveRuntimeRedisUrl,
} from "../../src/infrastructure/runtime/runtime-readiness.ts";

test("runtime url resolvers keep loopback hosts unchanged outside containers", () => {
  assert.equal(
    resolveRuntimeRedisUrl("redis://:secret@127.0.0.1:6380/0", false),
    "redis://:secret@127.0.0.1:6380/0",
  );
  assert.equal(
    resolveRuntimeDatabaseUrl(
      "postgresql://user:pass@localhost:5432/app?schema=public",
      false,
    ),
    "postgresql://user:pass@localhost:5432/app?schema=public",
  );
});

test("runtime url resolvers rewrite loopback hosts to host.docker.internal inside containers", () => {
  assert.equal(
    resolveRuntimeRedisUrl("redis://:secret@127.0.0.1:6380/0", true),
    "redis://:secret@host.docker.internal:6380/0",
  );
  assert.equal(
    resolveRuntimeDatabaseUrl(
      "postgresql://user:pass@localhost:5432/app?schema=public",
      true,
    ),
    "postgresql://user:pass@host.docker.internal:5432/app?schema=public",
  );
});

test("runtime url resolvers keep non-loopback hosts unchanged inside containers", () => {
  const redisUrl = "redis://:secret@cache.internal:6380/0";
  const databaseUrl = "postgresql://user:pass@db.internal:5432/app?schema=public";

  assert.equal(resolveRuntimeRedisUrl(redisUrl, true), redisUrl);
  assert.equal(resolveRuntimeDatabaseUrl(databaseUrl, true), databaseUrl);
});

test("container runtime detection recognizes container markers", () => {
  const originalKubernetesHost = process.env.KUBERNETES_SERVICE_HOST;
  const originalContainer = process.env.CONTAINER;

  process.env.KUBERNETES_SERVICE_HOST = "10.96.0.1";
  assert.equal(isContainerRuntime(), true);

  delete process.env.KUBERNETES_SERVICE_HOST;
  process.env.CONTAINER = "docker";
  assert.equal(isContainerRuntime(), true);

  if (originalKubernetesHost === undefined) {
    delete process.env.KUBERNETES_SERVICE_HOST;
  } else {
    process.env.KUBERNETES_SERVICE_HOST = originalKubernetesHost;
  }

  if (originalContainer === undefined) {
    delete process.env.CONTAINER;
  } else {
    process.env.CONTAINER = originalContainer;
  }
});

test("persistent storage root follows runtime environment", () => {
  assert.equal(resolvePersistentFileStorageRoot(false), "/var/lib/zook/appRunData");
  assert.equal(resolvePersistentFileStorageRoot(true), "/app/appRunData");
});
