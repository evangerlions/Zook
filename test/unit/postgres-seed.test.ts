import assert from "node:assert/strict";
import test from "node:test";

import { seedPostgresDefaults } from "../../src/infrastructure/database/postgres/postgres-seed.ts";
import type { DatabaseSeed } from "../../src/shared/types.ts";

test("postgres bootstrap inserts default apps without overwriting existing app names", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const seed: DatabaseSeed = {
    apps: [
      {
        id: "ai_novel",
        code: "ai_novel",
        name: "OrangeWrite",
        nameI18n: {
          "zh-CN": "橘子写作",
          "en-US": "OrangeWrite",
        },
        status: "ACTIVE",
        apiDomain: "ai-novel.example.com",
        joinMode: "AUTO",
        createdAt: "2026-03-01T09:00:00+08:00",
      },
    ],
  };

  await seedPostgresDefaults(seed, {
    query: async (sql, values) => {
      queries.push({ sql, values });
      return undefined;
    },
    insertUser: async () => undefined,
    insertAppUser: async () => undefined,
    insertSmsVerificationRecord: async () => undefined,
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? "", /INSERT INTO zook_apps/);
  assert.match(queries[0]?.sql ?? "", /ON CONFLICT \(id\) DO NOTHING/);
  assert.equal(queries[0]?.values?.[0], "ai_novel");
  assert.equal(queries[0]?.values?.[2], "OrangeWrite");
});
