import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickInvestmentBucketSnapshotEnvelopeSchema as snapshotSchema,
  LightTickInvestmentBucketViewEnvelopeSchema as viewSchema } from "../../src/generated/openapi/public-contracts.generated.ts";

test("account split allocates shares atomically, values complete positions, and preserves superseded assignments", async () => {
  const owner = { appId: "lighttick" as const, userId: "user_alice" };
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers.push({
    id: "bucket-test-" + userId, appId: "lighttick", userId, status: "ACTIVE",
    accountRegion: "UNKNOWN", joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const runtime = app.services.lighttickRuntime!;
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validateSnapshot = ajv.compile(snapshotSchema);
  const validateView = ajv.compile(viewSchema);
  const call = (path: string, method = "GET", body?: unknown, key = "bucket-read-only", user = owner.userId) =>
    app.app.handle({ path: "/api/v1/lighttick/investments/" + path, method, body, headers: {
      authorization: "Bearer " + app.services.tokenService.issueAccessToken(user, "lighttick"),
      "x-app-id": "lighttick", "idempotency-key": key,
    } });
  async function data(response: ReturnType<typeof call>, validate?: typeof validateView) {
    const result = await response;
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    if (validate) assert.ok(validate(JSON.parse(JSON.stringify(result.body))), JSON.stringify(validate.errors));
    return result.body.data as any;
  }
  const asset = (await data(call("instruments", "POST", { name: "Sample fund", code: "000866", market: "FUND", kind: "fund" }, "bucket-fund-identity"))).instrument;
  const account = "accounts/inv-bucket-account", path = account + "/buckets", portfolio = account + "/portfolio";
  await data(call(account, "PUT", { base_revision: 0, name: "Sample invested account", currency: "CNY", baseline_date: "2026-10-25",
    opening_cash: "500", opening_positions: [{ instrument_id: asset.id, quantity: "100", cost: "600" }] }, "bucket-account-0001"));
  assert.equal((await data(call(path), validateView)).holdings[0].unallocated, "100");
  const main = "inv-bucket-core", active = "inv-bucket-active";
  const definitions = [
    { id: main, kind: "holding", name: "长期盘", purpose: "长期配置", target_weight: "70" },
    { id: active, kind: "holding", name: "主动盘", purpose: "", target_weight: "30" },
    { id: "inv-bucket-observe", kind: "watch", name: "观察盘", purpose: "", instrument_ids: [asset.id], assumption: "Review NAV changes" },
  ];
  const allocation = (bucket_id: string, quantity: string) => ({ bucket_id, instrument_id: asset.id, quantity });
  const body = { base_revision: 0, base_account_revision: 1, buckets: definitions, allocations: [allocation(main, "60"), allocation(active, "40")] };
  assert.equal((await call(path, "PUT", { ...body, allocations: [allocation(main, "60.0000000001"), allocation(active, "40")] }, "bucket-overflow")).statusCode, 422);
  assert.equal((await call(path, "PUT", { ...body, allocations: [allocation("inv-bucket-observe", "1")] }, "bucket-observe-allocation")).statusCode, 422);
  assert.equal((await call(path, "PUT", { ...body, buckets: [{ ...definitions[0], target_weight: "71" }, ...definitions.slice(1)] }, "bucket-target-overflow")).statusCode, 422);
  const first = await data(call(path, "PUT", body, "bucket-first-revision"), validateSnapshot);
  assert.deepEqual(await data(call(path, "PUT", body, "bucket-first-revision"), validateSnapshot), first);
  assert.equal((await call(path, "PUT", { ...body, allocations: [allocation(main, "50")] }, "bucket-first-revision")).statusCode, 409);
  assert.equal((await data(call(path), validateView)).metrics[main].actual_weight, null);
  assert.equal((await call(path, "GET", undefined, undefined, "user_bob")).statusCode, 404);
  assert.equal((await call(path + "/versions/1", "GET", undefined, undefined, "user_bob")).statusCode, 404);

  await data(call(portfolio + "/facts/inv-bucket-nav", "PUT", {
    kind: "fund_nav", base_revision: 0, base_account_revision: 1, instrument_id: asset.id,
    date: "2026-10-26", nav: "10", source_label: "Sample confirmed NAV",
  }, "bucket-confirm-nav"));
  async function valuation(base: number, date: string) {
    const work = await data(call(portfolio + "/work", "POST",
      { kind: "valuation", date, base_revision: base, sources: {} }, "bucket-valuation-work-" + date));
    await runtime.worker!.portfolio!.execute(owner, work.id);
    const result = await data(call(portfolio + "/work/" + work.id));
    assert.equal(result.status, "succeeded");
    await data(call(portfolio + "/work/" + work.id + "/adopt", "POST", {
      base_revision: base, preview_digest: result.output.preview_digest,
    }, "bucket-adopt-valuation-" + date));
  }
  await valuation(2, "2026-10-26");
  const marked = await data(call(path), validateView);
  assert.equal(marked.metrics[main].actual_weight, "60");
  assert.equal(marked.metrics[main].deviation, "-10");
  assert.equal(marked.metrics[active].deviation, "10");
  assert.equal(marked.holdings_value, "1000");
  assert.equal(marked.unallocated_cash, "500");
  assert.deepEqual(marked.unallocated, { market_value: "0", actual_weight: "0", deviation: null, coverage: { available: 0, required: 0 } });
  assert.equal(Object.keys(marked.metrics).length, 2);

  const revised = { ...body, base_revision: 1, base_account_revision: 2, allocations: [allocation(main, "50"), allocation(active, "45")] };
  assert.equal((await call(path, "PUT", { ...revised, base_account_revision: 1 }, "bucket-old-account")).statusCode, 409);
  await data(call(path, "PUT", revised, "bucket-transfer"), validateSnapshot);
  const transfer = await data(call(path), validateView);
  assert.equal(transfer.unallocated.actual_weight, "5");
  assert.equal(transfer.holdings[0].unallocated, "5");
  assert.equal((await data(call(account))).revision, 2);
  assert.deepEqual(await data(call(path + "/versions/1"), validateSnapshot), first);

  const work = await data(call(account + "/events", "POST", {
    kind: "fill", base_revision: 2, business_date: "2026-10-27",
    fill: { instrument_id: asset.id, side: "sell", price: "10", quantity: "25", tax: "0", fee: "0",
      source: "fund_confirmation", settlement_amount: "250" },
  }, "bucket-fund-redemption"));
  await runtime.worker!.investments!.execute(owner, work.id);
  assert.equal((await data(call("work/" + work.id))).status, "succeeded");
  const over = await data(call(path), validateView);
  assert.equal(over.needs_review, true);
  assert.equal(over.valuation.status, "holdings_changed");
  assert.equal(over.holdings[0].excess, "20");
  assert.equal(over.snapshot.revision, 2);
  assert.equal(over.metrics[main].actual_weight, null);
  const rebalance = { ...revised, base_revision: 2, base_account_revision: 3, allocations: [allocation(main, "50"), allocation(active, "25")] };
  await data(call(path, "PUT", rebalance, "bucket-reconcile-shares"), validateSnapshot);
  await valuation(3, "2026-10-27");
  const missing = await data(call(path), validateView);
  assert.equal(missing.valuation.status, "partial");
  assert.equal(missing.holdings[0].price, null);
  assert.equal(missing.metrics[main].actual_weight, null);

  const [saleEvent] = await runtime.repository.investments.ledger.events(owner, "inv-bucket-account");
  assert.equal(saleEvent.input.kind, "fill");
  if (saleEvent.input.kind !== "fill") throw Error("Expected fund redemption");
  const correction = await data(call(account + "/events", "POST", {
    kind: "correction", base_revision: 3, business_date: "2026-10-27", correction: {
      target_event_id: saleEvent.id, target_input_digest: digest(saleEvent.input), reason: "确认赎回份额订正",
      replacement: { ...saleEvent.input, fill: { ...saleEvent.input.fill, quantity: "35", settlement_amount: "350" } },
    },
  }, "bucket-redemption-correction"));
  await runtime.worker!.investments!.execute(owner, correction.id);
  assert.equal((await data(call("work/" + correction.id))).status, "succeeded");
  const corrected = await data(call(path), validateView);
  assert.equal(corrected.valuation.status, "stale");
  assert.equal(corrected.holdings[0].quantity, "65");
  assert.equal(corrected.holdings[0].excess, "10");
  assert.equal(corrected.snapshot.revision, 3);

  await app.services.appConfigService.setValue("lighttick", "admin.delivery_config", JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }));
  assert.equal((await call(path, "PUT", { ...rebalance, base_revision: 3 }, "bucket-closed-scope")).statusCode, 503);
  assert.equal((await data(call(path), validateView)).history.length, 3);
});
