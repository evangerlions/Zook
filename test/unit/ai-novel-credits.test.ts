import assert from "node:assert/strict";
import test from "node:test";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { InMemoryAiNovelCreditsStore } from "../../src/testing/in-memory-ai-novel-credits-store.ts";
import { refreshCreditsAccount, type CreditsReceipt, type CreditsTier } from "../../src/modules/ai-novel/credits/ai-novel-credits-model.ts";

function fixture() {
  let tier: CreditsTier = "free", now = new Date("2026-10-04T12:00:00Z");
  const store = new InMemoryAiNovelCreditsStore();
  const service = new AiNovelCreditsService(store, async () => tier, undefined, () => now);
  return { service, store, tier: (value: CreditsTier) => { tier = value; }, time: (value: string) => { now = new Date(value); } };
}

test("expiry during balance transaction returns the effective Free tier and limit", async () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const service = new AiNovelCreditsService(new InMemoryAiNovelCreditsStore(), async () => ({
    tier: "plus", anchorAt: "2026-10-01T00:00:00Z", expiresAt: now.toISOString(),
  }), undefined, () => now);
  const balance = await service.balanceMicros("u");
  assert.equal(balance.tier, "free");
  assert.equal(balance.periodicLimitMicros, "20000000");
  assert.equal(balance.periodicMicros, "20000000");
});
function receipt(id: string, points: number): CreditsReceipt {
  return { callId: id, modelKey: "minimax-m3", usage: { promptTokens: points * 10_000, completionTokens: 0, totalTokens: points * 10_000 }, pricing: { inputPointsPerMillionTokens: 100, outputPointsPerMillionTokens: 400 }, pointMicros: String(points * 1_000_000) };
}
async function consume(f: ReturnType<typeof fixture>, id: string, points: number, outcome: "success" | "failure" | "cancelled" = "success") {
  await f.service.begin("u", id, "req");
  if (outcome === "success") await f.service.record("u", id, "req", receipt(`call:${id}`, points));
  await f.service.closeRequest("u", id, "req", outcome);
  return f.store.transact("u", id, (state) => state.job!);
}

test("Free starts an independent week on first credit account access", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.balance("u"), { tier: "free", periodicPoints: 20, periodicLimit: 20, giftPoints: 0, remainingPoints: 20, refreshAt: "2026-10-11T12:00:00.000Z" });
  await consume(f, "job", 15);
  f.time("2026-10-11T12:00:00Z");
  assert.equal((await f.service.balance("u")).periodicPoints, 20);
  assert.equal((await f.service.balance("u")).periodicPoints, 20);
  f.tier("plus");
  assert.equal((await f.service.balance("u")).periodicPoints, 1000);
  assert.equal((await f.service.balance("u")).refreshAt, "2026-10-18T12:00:00.000Z");
});

test("spends periodic before permanent gifts and absorbs overage without debt", async () => {
  const f = fixture();
  await f.service.grant("u", "campaign", 5);
  const result = await consume(f, "job", 22);
  assert.equal(result.chargedMicros, "22000000");
  assert.equal((await f.service.balance("u")).periodicPoints, 0);
  assert.equal((await f.service.balance("u")).giftPoints, 3);
  const overage = await consume(f, "job2", 10);
  assert.equal(overage.chargedMicros, "3000000");
  assert.equal(overage.absorbedMicros, "7000000");
  assert.equal((await f.service.balance("u")).remainingPoints, 0);
  assert.equal(await f.service.begin("u", "job3", "req"), "quota_insufficient");
});


for (const outcome of ["failure", "cancelled"] as const) {
  test(outcome + " before provider success costs zero", async () => {
    const f = fixture();
    await consume(f, outcome, 12, outcome);
    assert.equal((await f.service.balance("u")).remainingPoints, 20);
    assert.equal(await f.service.begin("u", "next", "r2"), "allowed");
  });
  test(outcome + " after a successful call cannot refund it", async () => {
    const f = fixture();
    await f.service.begin("u", "request", "r1");
    await f.service.record("u", "request", "r1", receipt("c1", 2));
    assert.equal((await f.service.balance("u")).remainingPoints, 18);
    await f.service.closeRequest("u", "request", "r1", outcome);
    assert.equal((await f.service.balance("u")).remainingPoints, 18);
    assert.equal(await f.service.begin("u", "next", "r2"), "allowed");
  });
}
test("successful calls debit immediately and duplicate callbacks debit once", async () => {
  const f = fixture();
  await f.service.begin("u", "request1", "r1");
  await Promise.all([
    f.service.record("u", "request1", "r1", receipt("c1", 2)),
    f.service.record("u", "request1", "r1", receipt("c1", 2)),
  ]);
  assert.equal((await f.service.balance("u")).remainingPoints, 18);
  await f.service.record("u", "request1", "r1", receipt("c2", 3));
  assert.equal((await f.service.balance("u")).remainingPoints, 15);
  await f.service.closeRequest("u", "request1", "r1", "success");
  await f.service.record("u", "request1", "r1", receipt("c1", 2));
  assert.equal((await f.service.balance("u")).remainingPoints, 15);
  await consume(f, "request2", 1);
  assert.equal((await f.service.balance("u")).remainingPoints, 14);
});
test("same-account concurrency cannot bypass admission; accounts are independent", async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.service.begin("u", "a", "r1"), f.service.begin("u", "b", "r2")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(f.service.begin("u", "a", "r3"));
  assert.equal(await f.service.begin("v", "a", "r3"), "allowed");
});
test("fractional credits debit exactly before request completion", async () => {
  const f = fixture();
  await f.service.begin("u", "tiny", "r");
  await f.service.record("u", "tiny", "r", receipt("fraction", 0.001));
  assert.equal((await f.service.balanceMicros("u")).remainingMicros, "19999000");
  await f.service.closeRequest("u", "tiny", "r", "cancelled");
  assert.equal((await f.service.balance("u")).remainingPoints, 19.999);
});

for (const left of [100, 5, 0]) {
  test(`membership expiry converts ${left} points to min(Free, remaining) without refilling`, async () => {
    const f = fixture(); f.tier("plus");
    await f.service.grant("u", "campaign", 7);
    await consume(f, "paid", 1000 - left);
    f.tier("free");
    assert.equal((await f.service.balance("u")).periodicPoints, Math.min(20, left));
    assert.equal((await f.service.balance("u")).giftPoints, 7);
    assert.equal((await f.service.balance("u")).periodicPoints, Math.min(20, left));
  });
}

test("gift retry is idempotent, conflicting amount rejected, gifts survive refresh", async () => {
  const f = fixture();
  await Promise.all([f.service.grant("u", "gift", 10), f.service.grant("u", "gift", 10)]);
  await assert.rejects(f.service.grant("u", "gift", 11));
  f.time("2026-11-05T00:00:00Z");
  assert.equal((await f.service.balance("u")).giftPoints, 10);
});

test("oversized and cumulative gifts reject atomically before an unsafe balance is persisted", async () => {
  const f = fixture();
  await assert.rejects(f.service.grant("u", "oversized", 9_007_199_255));
  assert.equal((await f.service.balanceMicros("u")).remainingMicros, "20000000");
  await f.service.grant("u", "large", 9_007_195_254);
  const before = await f.service.balanceMicros("u");
  assert.equal(before.remainingMicros, "9007195274000000");
  await assert.rejects(f.service.grant("u", "overflow", 1));
  assert.deepEqual(await f.service.balanceMicros("u"), before);
  // Rejected event ID was not recorded as a successful grant.
  f.tier("pro");
  assert.equal((await f.service.balanceMicros("u")).remainingMicros, "9007199254000000");
  await consume(f, "make-room", 4002);
  await f.service.grant("u", "overflow", 1);
});

test("expiry frees admission but a stale success cannot debit the new job", async () => {
  const f = fixture(); await f.service.begin("u", "old", "r");
  await f.service.record("u", "old", "r", receipt("oldcall", 10));
  f.time("2026-10-04T12:31:00Z");
  await f.service.begin("u", "new", "r2");
  await assert.rejects(f.service.record("u", "old", "r", receipt("late", 2)));
  assert.equal((await f.service.balance("u")).remainingPoints, 10);
  await assert.rejects(f.service.begin("u", "third", "r3"));
});

test("invalid receipt, unknown job and reserved gift namespace fail without mutation", async () => {
  const f = fixture();
  await assert.rejects(f.service.begin("u", "gift:campaign", "r"));
  await f.service.begin("u", "a", "r");
  await assert.rejects(f.service.record("u", "a", "r", { ...receipt("c", 1), pointMicros: "-1" }));
  await assert.rejects(f.service.record("u", "missing", "r", receipt("c", 1)));
  assert.equal((await f.service.balance("u")).remainingPoints, 20);
});

test("live request renewal keeps ownership beyond the original lease; stale renewal cannot regain it", async () => {
  const f = fixture();
  await f.service.begin("u", "long", "r");
  f.time("2026-10-04T12:29:00Z");
  await f.service.renewRequest("u", "long", "r");
  f.time("2026-10-04T12:31:00Z");
  await assert.rejects(f.service.begin("u", "other", "r2"));
  await f.service.record("u", "long", "r", receipt("longcall", 2));
  await f.service.releaseRequest("u", "long", "r");
  await assert.rejects(f.service.renewRequest("u", "long", "r"));
  assert.equal((await f.service.balance("u")).remainingPoints, 18);
});

test("expired request cannot renew over a newly admitted job", async () => {
  const f = fixture();
  await f.service.begin("u", "old", "r");
  f.time("2026-10-04T12:31:00Z");
  await f.service.begin("u", "new", "r2");
  await assert.rejects(f.service.renewRequest("u", "old", "r"));
  await assert.rejects(f.service.begin("u", "third", "r3"));
});

test("paid downgrade is capped and same-week upgrade only adds allowance difference", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  const account = refreshCreditsAccount(undefined, "plus", now);
  account.periodicMicros = "100000000";
  assert.equal(refreshCreditsAccount(account, "pro", now).periodicMicros, "3100000000");
  account.tier = "pro";
  assert.equal(refreshCreditsAccount(account, "plus", now).periodicMicros, "100000000");
});
