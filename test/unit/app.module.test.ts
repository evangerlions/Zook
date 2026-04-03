import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

test("createApplication resolves the migration database url before postgres bootstrap", async () => {
  const originalDirectUrl = process.env.DIRECT_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const postgresDatabaseClass = PostgresDatabase as typeof PostgresDatabase & {
    create: typeof PostgresDatabase.create;
  };
  const originalCreate = postgresDatabaseClass.create;
  let receivedConnectionString: string | undefined;
  let receivedMigrationConnectionString: string | undefined;

  process.env.DIRECT_URL = "postgresql://migrator:secret@127.0.0.1:5432/zook_dev?schema=public";
  delete process.env.DATABASE_URL;
  postgresDatabaseClass.create = async (connectionString, seed, options = {}) => {
    receivedConnectionString = connectionString;
    receivedMigrationConnectionString = options.migrationConnectionString;
    return new InMemoryDatabase(seed) as unknown as PostgresDatabase;
  };

  try {
    const runtime = await createApplication({
      databaseUrl: "postgresql://app:secret@127.0.0.1:5432/zook_dev?schema=public",
      queueBackend: "memory",
    });

    assert.ok(runtime.database);
    assert.equal(
      receivedConnectionString,
      "postgresql://app:secret@127.0.0.1:5432/zook_dev?schema=public",
    );
    assert.equal(
      receivedMigrationConnectionString,
      "postgresql://migrator:secret@127.0.0.1:5432/zook_dev?schema=public",
    );
  } finally {
    postgresDatabaseClass.create = originalCreate;
    if (originalDirectUrl === undefined) {
      delete process.env.DIRECT_URL;
    } else {
      process.env.DIRECT_URL = originalDirectUrl;
    }

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
});
