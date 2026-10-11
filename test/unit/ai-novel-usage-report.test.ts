import assert from "node:assert/strict";
import test from "node:test";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { InMemoryAiNovelCreditsStore } from "../../src/testing/in-memory-ai-novel-credits-store.ts";
import { buildUsageReport } from "../../src/modules/admin/ai-novel-usage-report.ts";
import { usageFilter } from "../../src/services/ai-novel-usage-admin.service.ts";
import type {
  UsageFilter,
  UsageSource,
  CreditWindowSnapshot,
} from "../../src/shared/types/ai-novel-usage-admin.ts";

const filter: UsageFilter = {
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-12T00:00:00.000Z",
  asOf: "2026-10-11T08:00:00.000Z",
  tier: "all",
  sandbox: false,
};
const receipt = (id = "call", micros = "30000000") => ({
  callId: id,
  modelKey: "model",
  pointMicros: micros,
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  pricing: {
    inputPointsPerMillionTokens: 100,
    outputPointsPerMillionTokens: 100,
  },
});
const empty = (): UsageSource => ({
  events: [],
  windows: [],
  accounts: [],
  payments: [],
  reportingSince: filter.from,
});
const window = (
  changes: Partial<CreditWindowSnapshot> = {},
): CreditWindowSnapshot => ({
  userId: "user",
  start: filter.from,
  end: "2026-10-08T00:00:00.000Z",
  tier: "plus",
  limitMicros: "1000000000",
  spentMicros: "500000000",
  covered: true,
  stable: true,
  ...changes,
});

test("canonical settlement records exact two pools and absorbed overage once; cancellation retains earlier successful debit", async () => {
  const store = new InMemoryAiNovelCreditsStore();
  const service = new AiNovelCreditsService(
    store,
    async () => "free",
    undefined,
    () => new Date(filter.from),
  );
  await service.grant("user", "promotion", 5);
  await service.begin("user", "job", "request");
  await service.record("user", "job", "request", receipt());
  await service.record("user", "job", "request", receipt());
  await service.closeRequest("user", "job", "request", "cancelled");
  assert.equal(
    await service.begin("user", "deny", "deny-request"),
    "quota_insufficient",
  );
  const source = await store.readUsageReport(filter),
    report = buildUsageReport(source, filter);
  assert.equal(source.events.filter((e) => e.kind === "debit").length, 1);
  assert.deepEqual(report.summary, {
    payingUsers: 0,
    activeUsers: 1,
    chargedPoints: 25,
    giftPoints: 5,
    absorbedPoints: 5,
    denied: 1,
  });
  assert.equal(report.models[0]?.points, 30);
  assert.equal(report.tiers[0]?.exhausted, 1);
  assert.equal(report.simulation[0]?.consumption[0], 25);
});

test("failed/cancelled provider requests before settlement and rollback create no debit evidence", async () => {
  const store = new InMemoryAiNovelCreditsStore();
  const service = new AiNovelCreditsService(
    store,
    async () => "free",
    undefined,
    () => new Date(filter.from),
  );
  for (const status of ["failure", "cancelled"] as const) {
    await service.begin("user", status, status);
    await service.closeRequest("user", status, status, status);
  }
  await assert.rejects(
    store.transact("user", "bad", (state) => {
      state.account!.periodicMicros = "0";
      throw Error("rollback");
    }),
  );
  assert.equal((await store.readUsageReport(filter)).events.length, 0);
  assert.equal(
    (await service.balanceMicros("user")).remainingMicros,
    "20000000",
  );
});

test("partial, upgraded, inactive and not-yet-ended windows excluded; remaining observations keep exact denominator", () => {
  const source = empty();
  source.windows = [
    window(),
    window({ covered: false }),
    window({ stable: false }),
    window({ spentMicros: "0" }),
    window({ end: "2026-10-11T12:00:00.000Z" }),
  ];
  const plus = buildUsageReport(source, filter).tiers[1]!;
  assert.equal(plus.windows, 1);
  assert.equal(plus.excludedWindows, 3);
  assert.equal(plus.usedPercent, 50);
  assert.equal(plus.p50, 500);
  assert.equal(plus.p95, 500);
  assert.equal(
    plus.distribution.reduce((a, b) => a + b),
    1,
  );
});

test("simulation independent of global tier; financial environment and currency remain separate; refunds use own date", () => {
  const source = empty();
  source.windows = [window({ tier: "pro", limitMicros: "4000000000" })];
  source.payments = [
    {
      userId: "a",
      at: filter.from,
      kind: "purchase",
      currency: "CNY",
      amountMinor: 3900,
      sandbox: false,
      tier: "plus",
    },
    {
      userId: "a",
      at: "2026-10-03T00:00:00.000Z",
      kind: "refund",
      currency: "CNY",
      amountMinor: 1950,
      sandbox: false,
      tier: "plus",
    },
    {
      userId: "b",
      at: filter.from,
      kind: "purchase",
      currency: "USD",
      amountMinor: 999,
      sandbox: false,
      tier: "plus",
    },
    {
      userId: "c",
      at: filter.from,
      kind: "purchase",
      currency: "CNY",
      amountMinor: 5000,
      sandbox: true,
      tier: "plus",
    },
  ];
  const report = buildUsageReport(source, { ...filter, tier: "plus" });
  assert.equal(report.summary.payingUsers, 2);
  assert.equal(report.money.length, 3);
  assert.equal(
    report.money.find((r) => r.date === "2026-10-03")?.refundMinor,
    1950,
  );
  assert.deepEqual(
    report.simulation.find((r) => r.tier === "pro")?.consumption,
    [500],
  );
  assert.equal(
    buildUsageReport(source, { ...filter, sandbox: true }).summary.payingUsers,
    1,
  );
});

test("first legacy window is uncovered; next weekly snapshot covered; an upgrade makes its same-window sample unstable", async () => {
  let now = new Date("2026-10-02T00:00:00.000Z"),
    tier: "plus" | "pro" = "plus";
  const store = new InMemoryAiNovelCreditsStore();
  await store.transact("user", "", (state) => {
    state.account = {
      tier: "plus",
      periodicMicros: "1000000000",
      giftMicros: "0",
      periodKey: filter.from,
      refreshAt: "2026-10-08T00:00:00.000Z",
      windowAnchorAt: filter.from,
      spentMicros: "0",
    };
  });
  const service = new AiNovelCreditsService(
    store,
    async () => tier,
    undefined,
    () => now,
  );
  await service.balanceMicros("user");
  now = new Date("2026-10-08T01:00:00.000Z");
  await service.begin("user", "job", "request");
  await service.record("user", "job", "request", receipt("call", "1000000"));
  tier = "pro";
  await service.balanceMicros("user");
  const source = await store.readUsageReport({
    from: filter.from,
    to: "2026-10-20T00:00:00.000Z",
  });
  assert.equal(source.windows[0]?.covered, false);
  assert.equal(source.windows[1]?.covered, true);
  assert.equal(source.windows[1]?.stable, false);
});

test("query validation and no-sample nulls do not invent zeros", () => {
  for (const query of [
    { days: "10000" },
    { tier: "gold" },
    { environment: "all" },
    { userId: "x' OR true" },
  ])
    assert.throws(() => usageFilter(query));
  const parsed = usageFilter({ days: "7" }, new Date(filter.asOf));
  assert.equal(parsed.from, "2026-10-05T00:00:00.000Z");
  assert.equal(parsed.to, filter.to);
  assert.equal(buildUsageReport(empty(), filter).tiers[0]?.usedPercent, null);
});

test("membership activation invalidates the replaced Free window, even when synchronized after its scheduled end", async () => {
  for (const syncTime of [
    "2026-10-03T00:00:00.000Z",
    "2026-10-10T00:00:00.000Z",
  ]) {
    const store = new InMemoryAiNovelCreditsStore();
    let now = new Date(filter.from),
      membership: { tier: "free" | "plus"; anchorAt?: string } = {
        tier: "free",
      };
    const service = new AiNovelCreditsService(
      store,
      async () => membership,
      undefined,
      () => now,
    );
    await service.begin("user", "job", "request");
    await service.record("user", "job", "request", receipt("call", "1000000"));
    await service.releaseRequest("user", "job", "request");
    now = new Date(syncTime);
    membership = { tier: "plus", anchorAt: "2026-10-03T00:00:00.000Z" };
    await service.balanceMicros("user");
    const source = await store.readUsageReport(filter);
    assert.equal(source.windows.find((w) => w.tier === "free")?.stable, false);
    assert.equal(buildUsageReport(source, filter).tiers[0]?.windows, 0);
  }
});

test("known paid expiry inside a window excludes it without needing a later client interaction", () => {
  const source = empty();
  source.windows = [
    window({ entitlementExpiresAt: "2026-10-04T00:00:00.000Z" }),
  ];
  assert.equal(buildUsageReport(source, filter).tiers[1]?.windows, 0);
});
