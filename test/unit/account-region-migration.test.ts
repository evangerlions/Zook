import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("account-region migration installs the immutable membership column", async () => {
  const sql = await readFile(
    new URL(
      "../../src/infrastructure/database/postgres/migrations/026_app_user_account_region.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(sql, /ADD COLUMN IF NOT EXISTS account_region/);
  assert.match(sql, /CHECK \(account_region IN \('CN', 'GLOBAL', 'UNKNOWN'\)\)/);
  assert.match(sql, /ALTER COLUMN account_region SET NOT NULL/);
});
