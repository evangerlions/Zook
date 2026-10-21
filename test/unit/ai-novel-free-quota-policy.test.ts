import assert from "node:assert/strict";
import test from "node:test";
import { refreshCreditsAccount, type CreditsAccount } from "../../src/modules/ai-novel/credits/ai-novel-credits-model.ts";
const now = new Date("2026-10-20T00:00:00Z");

test("Free grants 200 for seven days; legacy balances gain only the difference once", () => {
  const fresh = refreshCreditsAccount(undefined, "free", now);
  assert.equal(fresh.periodicMicros, "200000000");
  assert.equal(fresh.refreshAt, "2026-10-27T00:00:00.000Z");
  const { quotaMicros, ...legacy } = fresh;
  legacy.periodicMicros = "5000000";
  legacy.spentMicros = "15000000";
  legacy.giftMicros = "7000000";
  const migrated = refreshCreditsAccount(legacy, "free", now);
  assert.equal(migrated.periodicMicros, "185000000");
  assert.equal(migrated.spentMicros, "15000000");
  assert.equal(migrated.giftMicros, legacy.giftMicros);
  assert.equal(migrated.refreshAt, legacy.refreshAt);
  assert.deepEqual(refreshCreditsAccount(migrated, "free", now), migrated);
  assert.equal(refreshCreditsAccount(migrated, "free", new Date(migrated.refreshAt)).periodicMicros, "200000000");
});

test("legacy exhausted and spent-metadata-free accounts preserve consumption", () => {
  const fresh = refreshCreditsAccount(undefined, "free", now);
  const { quotaMicros, spentMicros, ...legacy } = fresh;
  legacy.periodicMicros = "0";
  assert.equal(refreshCreditsAccount(legacy as CreditsAccount, "free", now).periodicMicros, "180000000");
});
