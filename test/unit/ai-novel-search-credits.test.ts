import assert from "node:assert/strict";
import test from "node:test";
import { searchCreditFixture, searchInput as input, searchContext as ctx, searchRow } from "../support/search-credit-fixture.ts";
import { parseSearchConfig, defaultSearchConfig } from "../../src/modules/ai-novel/search/search-config.ts";
import { searchCreditCharge } from "../../src/modules/ai-novel/search/search-credit-charge.ts";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";

const execute = (f: Awaited<ReturnType<typeof searchCreditFixture>>, id = input.toolCallId) =>
  f.service.execute({ ...input, toolCallId: id }, { ...ctx, requestId: `request:${id}` });

test("effective nonempty search costs two points through the existing account and ledger", async () => {
  const f = await searchCreditFixture();
  assert.equal((await execute(f)).status, "completed");
  assert.equal(await f.balance(), 198);
  const debit = (await f.events()).find(e => e.kind === "debit")!;
  assert.equal(debit.source, "web_search");
  assert.equal(debit.modelKey, undefined);
  assert.equal(debit.periodicMicros, "2000000");
  const record = (await f.usage.records())[0];
  assert.equal(record.chargedPoints, 2);
  assert.equal(record.billingStatus, "charged");
  const charge = searchCreditCharge(input, 2);
  const job = await f.store.transact("u", `tool:web_search:${charge.id}`, state => state.job!);
  assert.deepEqual(job.receipts, [], "search must not fabricate model token receipts");
  assert.equal(job.fixedCharge?.pointMicros, "2000000");
});

for (const mode of ["empty", "query_blocked", "results_blocked", "moderation_failed", "provider_failed", "timeout", "cancelled"] as const) {
  test(`${mode} search never charges`, async () => {
    const f = await searchCreditFixture();
    const abort = new AbortController();
    if (mode === "empty") f.upstream.fetch = async () => Response.json({ results: [] });
    if (mode === "query_blocked" || mode === "results_blocked") f.moderation.decide = async c => ({ allowed: c.taskType !== (mode === "query_blocked" ? "web_search_query" : "web_search_result"), layer: "llm" });
    if (mode === "moderation_failed") f.moderation.decide = async () => { throw Error("moderation down"); };
    if (mode === "provider_failed") f.upstream.fetch = async () => { throw Error("provider down"); };
    if (mode === "timeout" || mode === "cancelled") {
      f.config.totalTimeoutMs = 100;
      f.upstream.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
        if (mode === "cancelled") abort.abort(new Error("stop"));
      });
    }
    const keepAlive = setTimeout(() => {}, 500);
    try {
      const pending = f.service.execute(input, { ...ctx, signal: abort.signal });
      if (mode === "cancelled") await assert.rejects(pending, /stop/); else await pending;
      assert.equal(await f.balance(), 200);
      assert.equal((await f.events()).filter(e => e.kind === "debit").length, 0);
    } finally { clearTimeout(keepAlive); }
  });
}

test("partially filtered results cost one search, independent of returned item count", async () => {
  const f = await searchCreditFixture();
  f.upstream.fetch = async () => Response.json({ results: [searchRow, { ...searchRow, url: "https://example.com/other", title: "拒绝" }] });
  f.moderation.decide = async c => ({ allowed: !JSON.stringify(c).includes("拒绝"), layer: "llm" });
  const result = await execute(f);
  assert.equal(result.status, "completed");
  if (result.status === "completed") assert.equal(result.results.length, 1);
  assert.equal(await f.balance(), 198);
});

test("paid HTTP retries reuse retained results without another supplier call or debit", async () => {
  const f = await searchCreditFixture();
  const first = await execute(f);
  f.config.pointsPerSearch = 9;
  assert.deepEqual(await f.service.execute(input, { ...ctx, requestId: "retry" }), first);
  assert.equal(f.calls(), 1);
  assert.equal(await f.balance(), 198);
  assert.equal((await f.events()).filter(e => e.kind === "debit").length, 1);
  assert.equal((await f.usage.records())[0].billingStatus, "replayed");
  assert.equal((await f.usage.records())[0].chargedPoints, 0);
  assert.equal((await execute(f, "new-search")).status, "completed");
  assert.equal(await f.balance(), 189);
});

test("reusing a paid tool ID with different input fails before another supplier call", async () => {
  const f = await searchCreditFixture();
  await execute(f);
  assert.deepEqual(await f.service.execute({ ...input, query: "different" }, { ...ctx, requestId: "changed-input" }), { status: "unavailable", code: "CALL_CONFLICT" });
  assert.equal(f.calls(), 1);
  assert.equal(await f.balance(), 198);
});

test("expired replay retention cannot turn a paid ID into fresh free searches", async () => {
  const f = await searchCreditFixture();
  await execute(f);
  f.usage.records = async () => [];
  assert.deepEqual(await execute(f), { status: "unavailable", code: "CALL_CONFLICT" });
  assert.equal(f.calls(), 1);
  assert.equal(await f.balance(), 198);
});

test("insufficient total points denies before supplier calls and never partially debits", async () => {
  const f = await searchCreditFixture();
  await f.setBalance(1, 0.5);
  assert.deepEqual(await execute(f), { status: "unavailable", code: "CREDITS_INSUFFICIENT" });
  assert.equal(f.calls(), 0);
  assert.equal(await f.balance(), 1.5);
});

test("search consumes periodic points then gifts through the shared debit primitive", async () => {
  const f = await searchCreditFixture();
  await f.setBalance(1, 5);
  await execute(f);
  const b = await f.credits.balance("u");
  assert.equal(b.periodicPoints, 0);
  assert.equal(b.giftPoints, 4);
  assert.equal((await f.events()).find(e => e.kind === "debit")!.giftMicros, "1000000");
});

test("concurrent distinct searches cannot overdraw or return unpaid results", async () => {
  const f = await searchCreditFixture();
  await f.setBalance(2);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  f.upstream.fetch = async () => { if (++calls === 2) release(); await ready; return Response.json({ results: [searchRow] }); };
  const outcomes = await Promise.all([execute(f, "a"), execute(f, "b")]);
  assert.equal(outcomes.filter(x => x.status === "completed").length, 1);
  assert.deepEqual(outcomes.find(x => x.status !== "completed"), { status: "unavailable", code: "CREDITS_INSUFFICIENT" });
  assert.equal(await f.balance(), 0);
  assert.equal((await f.events()).filter(e => e.kind === "debit").length, 1);
});

test("concurrent identical tool calls settle only once across credit service instances", async () => {
  const f = await searchCreditFixture();
  const charge = searchCreditCharge(input, 2);
  const { AiNovelCreditsService } = await import("../../src/modules/ai-novel/credits/ai-novel-credits.service.ts");
  const second = new AiNovelCreditsService(f.store, async () => "free");
  const settled = await Promise.all([f.credits.settleFixedCharge("u", "r1", charge), second.settleFixedCharge("u", "r2", charge)]);
  assert.deepEqual(settled.sort(), ["charged", "replayed"]);
  assert.equal(await f.balance(), 198);
});

test("price is captured before the supplier call and settlement failure exposes no results", async () => {
  const f = await searchCreditFixture();
  f.upstream.fetch = async () => { f.config.pointsPerSearch = 10; return Response.json({ results: [searchRow] }); };
  await execute(f);
  assert.equal(await f.balance(), 198);
  assert.equal((await f.usage.records())[0].chargedPoints, 2);
  f.credits.settleFixedCharge = async () => { throw Error("database unavailable"); };
  assert.deepEqual(await execute(f, "new"), { status: "unavailable", code: "BILLING_UNAVAILABLE" });
  assert.equal(await f.balance(), 198);
});

test("cancelled or expired transactions cannot write a delayed debit", async () => {
  const f = await searchCreditFixture();
  const stop = new AbortController();
  stop.abort(new Error("stop"));
  await assert.rejects(f.credits.settleFixedCharge("u", "r", searchCreditCharge(input, 2), stop.signal), /stop/);
  assert.equal(await f.balance(), 200);
});

test("Admin tests do not create or debit a user account", async () => {
  const f = await searchCreditFixture();
  assert.equal((await f.service.executeAdminTest(input, ctx)).status, "completed");
  assert.equal((await f.events()).length, 0);
  assert.equal((await f.usage.records())[0].billingStatus, "admin_test");
});

test("production and sandbox credits keep independent fixed-charge receipts", async () => {
  const f = await searchCreditFixture();
  const charge = searchCreditCharge(input, 2);
  assert.equal(await inBillingEnvironment("production", () => f.credits.settleFixedCharge("u", "prod", charge)), "charged");
  assert.equal(await inBillingEnvironment("sandbox", () => f.credits.settleFixedCharge("u", "sandbox", charge)), "charged");
  assert.equal(await inBillingEnvironment("production", f.balance), 198);
  assert.equal(await inBillingEnvironment("sandbox", f.balance), 198);
});

test("old config revisions adopt two points; invalid and fractional prices are rejected", () => {
  const { pointsPerSearch, ...old } = defaultSearchConfig;
  assert.equal(parseSearchConfig(old).pointsPerSearch, 2);
  assert.equal(parseSearchConfig({ ...old, pointsPerSearch: 4 }).pointsPerSearch, 4);
  for (const price of [null, 0, -1, 1.5, 10001, "2"]) assert.throws(() => parseSearchConfig({ ...old, pointsPerSearch: price }));
});

test("abort while membership lookup is pending cannot leave a late debit", async () => {
  const f = await searchCreditFixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { AiNovelCreditsService } = await import("../../src/modules/ai-novel/credits/ai-novel-credits.service.ts");
  const delayed = new AiNovelCreditsService(f.store, async () => { await gate; return "free"; });
  const abort = new AbortController();
  const pending = delayed.settleFixedCharge("u", "delayed", searchCreditCharge(input, 2), abort.signal);
  abort.abort(new Error("deadline elapsed"));
  release();
  await assert.rejects(pending, /deadline elapsed/);
  assert.equal(await f.balance(), 200);
});

test("search debits count in overall usage without inventing a model identity", async () => {
  const f = await searchCreditFixture();
  await execute(f);
  const { buildUsageReport } = await import("../../src/modules/admin/ai-novel-usage-report.ts");
  const from = "2000-01-01T00:00:00.000Z", to = "2100-01-01T00:00:00.000Z";
  const source = await f.store.readUsageReport({ from, to });
  const report = buildUsageReport(source, { from, to, asOf: new Date().toISOString(), tier: "all", sandbox: false });
  assert.equal(report.summary.chargedPoints, 2);
  assert.deepEqual(report.models, []);
});
