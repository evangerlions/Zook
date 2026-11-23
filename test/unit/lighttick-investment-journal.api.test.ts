import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as contracts from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
import { exportInvestments } from "../../src/modules/lighttick/investments/ledger.export.ts";

test("investment journal API preserves exact evidence, corrected fills, reviews and original requests", async () => {
  const owner = { appId: "lighttick" as const, userId: "user_alice" };
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers.push({
    id: "journal-" + userId, appId: "lighttick", userId, status: "ACTIVE",
    accountRegion: "UNKNOWN", joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const runtime = app.services.lighttickRuntime!;
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);

  function call(path: string, method = "GET", body?: unknown, key = "journal-unused", userId = owner.userId, query?: Record<string, string>) {
    return app.app.handle({ path: "/api/v1/lighttick/investments/" + path, method, body, query, headers: {
      authorization: "Bearer " + app.services.tokenService.issueAccessToken(userId, "lighttick"),
      "x-app-id": "lighttick", "idempotency-key": key,
    } });
  }
  function data(response: any, name?: string): any {
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    if (name) {
      const validate = ajv.compile((contracts as Record<string, any>)["LightTickInvestment" + name + "EnvelopeSchema"]);
      assert.ok(validate(JSON.parse(JSON.stringify(response.body))), JSON.stringify(validate.errors));
      assert.equal(response.headers["Cache-Control"], "no-store");
    }
    return response.body.data;
  }
  const journal = (name: string, response: any) => data(response, "Journal" + name);
  const instrument = data(await call("instruments", "POST",
    { market: "SSE", kind: "stock", code: "600000", name: "Synthetic equity" }, "journal-instrument")).instrument;
  const wrong = data(await call("instruments", "POST",
    { market: "SSE", kind: "stock", code: "600001", name: "Different equity" }, "journal-wrong-instrument")).instrument;
  const start = "2025-01-01";
  const researchId = "inv-journal-research", decisionId = "inv-journal-decision", watchPath = "journal/watchlist/" + instrument.id;
  const decisionPath = "journal/decisions/" + decisionId;
  const research = { ...Object.fromEntries(researchFields.map(name => [name, ""])),
    base_revision: 0, instrument_id: instrument.id, account_id: null, title: "Original research", horizon: "swing",
    evidence: [], market_sources: [] };
  data(await call("research/" + researchId, "PUT", research, "journal-research-one"));
  journal("WatchlistState", await call(watchPath, "PUT", { following: true }, "journal-follow"));
  const draft = { base_revision: 0, instrument_id: instrument.id, action: "watch", reason: "Wait for the filing",
    occurred_at: start + "T10:00:00+08:00", review_on: start, evidence: [{ kind: "research", id: researchId, revision: 1 }] };
  const first = journal("Decision", await call(decisionPath, "PUT", draft, "journal-decision-one"));
  assert.equal(first.backfilled, true);
  assert.equal(first.occurred_at, "2025-01-01T02:00:00.000Z");
  assert.deepEqual(journal("Decision", await call(decisionPath, "PUT", draft, "journal-decision-one")), first);
  assert.deepEqual(journal("Receipt", await call("journal/receipts/journal-decision-one")).result, first);
  assert.equal((await call(decisionPath, "PUT", { ...draft, action: "sell" }, "journal-decision-one")).statusCode, 409);
  assert.equal((await call(decisionPath, "GET", undefined, undefined, "user_bob")).statusCode, 404);
  assert.equal((await call(watchPath, "PUT", { following: true }, "journal-foreign", "user_bob")).statusCode, 404);
  assert.equal(journal("Dashboard", await call("journal")).reviews_due[0].id, decisionId);
  data(await call("research/" + researchId, "PUT", { ...research, base_revision: 1, title: "Updated research" }, "journal-research-two"));
  assert.equal(journal("Evidence", await call("journal/evidence/research/" + researchId + "/1")).entry.title, "Original research");

  const account = "inv-journal-account", accountPath = "accounts/" + account;
  data(await call(accountPath, "PUT", { name: "Synthetic account", currency: "CNY", base_revision: 0, baseline_date: start,
    opening_cash: "1000", opening_positions: [] }, "journal-account"));
  assert.deepEqual(data(await call(accountPath + "/valuations/latest"), "LatestValuation"), { valuation: null });
  const fill = { instrument_id: instrument.id, side: "buy", price: "11.25", quantity: "10",
    fee: "0", tax: "0", source: "manual", settlement_amount: null };
  const work = data(await call(accountPath + "/events", "POST",
    { base_revision: 1, kind: "fill", business_date: start, fill }, "journal-fill"));
  await runtime.worker!.investments!.execute(owner, work.id);
  const event = data(await call(accountPath + "/ledger", "GET", undefined, undefined, undefined, { ledger_schema: "2" })).items[0];
  assert.equal((await call("journal/decisions/inv-journal-wrong", "PUT",
    { ...draft, instrument_id: wrong.id, evidence: [], account_id: account, event_ids: [event.id] }, "journal-bad-link")).statusCode, 422);
  const second = journal("Decision", await call(decisionPath, "PUT", {
    ...draft, base_revision: 1, action: "buy", account_id: account, event_ids: [event.id],
  }, "journal-decision-two"));
  assert.deepEqual(second.evidence, first.evidence);

  const correction = data(await call(accountPath + "/events", "POST", {
    base_revision: 2, business_date: start, kind: "correction", correction: {
      target_event_id: event.id, target_input_digest: event.effective_fact.input_digest, reason: "Verified correction",
      replacement: { business_date: start, kind: "fill", fill: { ...fill, price: "11.75" } },
    },
  }, "journal-fill-correction"));
  await runtime.worker!.investments!.execute(owner, correction.id);
  const detail = journal("DecisionDetail", await call(decisionPath));
  assert.equal(detail.fills[0].effective.input.fill.price, "11.75");
  assert.equal(detail.fills[0].original.input.fill.price, "11.25");

  const reviewPath = decisionPath + "/reviews/inv-journal-review";
  const review = { decision_revision: 1, thesis_outcome: "mixed", execution: "followed", result: "Partial validation", next_step: "Review cash flows next quarter" };
  assert.equal((await call(reviewPath, "PUT", review, "journal-review-old")).statusCode, 409);
  const reviewed = journal("Review", await call(reviewPath, "PUT", { ...review, decision_revision: 2 }, "journal-review"));
  assert.deepEqual(journal("Review", await call(reviewPath, "PUT", { ...review, decision_revision: 2 }, "journal-review")), reviewed);
  assert.deepEqual(journal("Dashboard", await call("journal")).reviews_due, []);
  const timelinePath = "journal/instruments/" + instrument.id + "/timeline";
  const timeline = journal("Timeline", await call(timelinePath));
  assert.deepEqual(new Set(timeline.items.map((row: any) => row.kind)), new Set(["fill", "research", "decision", "review"]));
  const page = journal("Timeline", await call(timelinePath, "GET", undefined, undefined, undefined, { limit: "1" }));
  assert.equal((await call(timelinePath, "GET", undefined, undefined, undefined, { kind: "decision", cursor: page.next_cursor })).statusCode, 409);
  assert.equal(journal("DecisionDetail", await call(decisionPath, "GET", undefined, undefined, undefined, { revision: "1" })).decision.action, "watch");
  const exported = await runtime.repository.transaction(owner, () => exportInvestments(runtime.repository, owner));
  assert.equal(exported.journal?.decisions[decisionId].length, 2);

  journal("Decision", await call(decisionPath, "PUT", {
    ...draft, base_revision: 2, action: "hold", account_id: account, event_ids: [event.id], review_on: "2025-01-02",
  }, "journal-decision-rescheduled"));
  assert.equal(journal("Dashboard", await call("journal")).reviews_due[0].revision, 3);

  const historyPath = "journal/decisions";
  const readHistory = async (query?: Record<string, string>, userId?: string) =>
    journal("History", await call(historyPath, "GET", undefined, undefined, userId, query));
  const midnightId = "inv-journal-midnight";
  await call(historyPath + "/" + midnightId, "PUT", {
    base_revision: 0, instrument_id: wrong.id, action: "watch", reason: "Local day boundary fixture",
    occurred_at: "2025-01-02T00:05:00+08:00",
  }, "journal-midnight-test").then(result => journal("Decision", result));
  for (let index = 0; index < 21; index++) {
    const suffix = String(index).padStart(2, "0");
    journal("Decision", await call(historyPath + "/inv-journal-new-" + suffix, "PUT", {
      base_revision: 0, instrument_id: wrong.id, action: "watch", reason: "New decision " + suffix,
      occurred_at: `2025-02-01T10:${suffix}:00+08:00`,
    }, "journal-history-new-" + suffix));
  }
  assert.ok(!journal("Dashboard", await call("journal")).recent_decisions.some((row: any) => row.id === decisionId));
  const firstHistory = await readHistory();
  assert.equal(firstHistory.items.length, 20);
  assert.equal(firstHistory.items[0].decision.reason, "New decision 20");
  const rest = await readHistory({ cursor: firstHistory.next_cursor });
  assert.deepEqual(rest.items.map((row: any) => row.decision.id), ["inv-journal-new-00", midnightId, decisionId]);
  assert.equal(rest.next_cursor, null);
  const historicalReview = (await readHistory({ q: "CASH FLOWS", outcome: "mixed", review_status: "due",
    instrument_id: instrument.id, action: "hold", from: start, to: start })).items[0];
  assert.equal(historicalReview.decision.id, decisionId);
  assert.equal(historicalReview.decision.revision, 3);
  assert.equal(historicalReview.decision.reviewed, false);
  assert.equal(historicalReview.latest_review.decision_revision, 2);
  assert.equal(historicalReview.latest_review.thesis_outcome, "mixed");
  assert.deepEqual((await readHistory({ from: "2025-01-02", to: "2025-01-02" })).items.map((row: any) => row.decision.id), [midnightId]);
  assert.deepEqual((await readHistory({}, "user_bob")).items, []);
  assert.equal((await call(historyPath, "GET", undefined, undefined, "user_bob", { cursor: firstHistory.next_cursor })).statusCode, 409);
  assert.equal((await call(historyPath, "GET", undefined, undefined, undefined, { action: "watch", cursor: firstHistory.next_cursor })).statusCode, 409);
  assert.equal((await call(historyPath, "GET", undefined, undefined, undefined, { from: "2025-02-01", to: "2025-01-01" })).statusCode, 422);
  journal("Decision", await call(historyPath + "/" + midnightId, "PUT", {
    base_revision: 1, instrument_id: wrong.id, action: "hold", reason: "Changed during pagination",
  }, "journal-invalidates-history-cursor"));
  assert.equal((await call(historyPath, "GET", undefined, undefined, undefined, { cursor: firstHistory.next_cursor })).statusCode, 409);

  await app.services.appConfigService.setValue("lighttick", "admin.delivery_config", JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }));
  assert.equal((await call(watchPath, "PUT", { following: false }, "journal-core-write")).statusCode, 503);
  journal("DecisionDetail", await call(decisionPath));
  assert.equal((await readHistory({ q: "600000" })).items[0].decision.id, decisionId);
  journal("Receipt", await call("journal/receipts/journal-decision-one"));
  await runtime.repository.deleteOwnerData(owner);
  assert.equal(await runtime.repository.investments.journal.get(owner), undefined);
});
