import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
test("market HTTP contract publishes owner-only CSV snapshots without requiring financial accounts or sending secrets", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "market-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    runtime = app.services.lighttickRuntime!,
    owner = { appId: "lighttick" as const, userId: "user_alice" },
    ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "market-http-original",
    user = "user_alice",
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/investments/" + path,
      body,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  const check = (kind: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const v = ajv.compile(
      (schemas as any)["LightTickInvestmentMarket" + kind + "EnvelopeSchema"],
    );
    assert.equal(
      v(JSON.parse(JSON.stringify(r.body))),
      true,
      JSON.stringify(v.errors),
    );
    return r.body.data;
  };
  const i: any = (
    await call(
      "instruments",
      "POST",
      { code: "600000", kind: "stock", market: "SSE", name: "Synthetic" },
      "market-http-symbol",
    )
  ).body;
  const b = {
    instrument_id: i.data.instrument.id,
    base_revision: 1,
    supplier: "csv",
    start: "2026-10-30",
    end: "2026-10-30",
    declared_source: "Synthetic CSV",
    volume_unit: "shares",
    amount_unit: "CNY",
    csv: "date,open,high,low,close,volume,amount\n2026-10-30,10,12,9,11,100,9007199254740993.0000000001\n",
  };
  const cap = check("Capabilities", await call("market/capabilities"));
  assert.equal(
    cap.suppliers.find((p: any) => p.supplier === "tushare").enabled,
    false,
  );
  const w = check("Work", await call("market/work", "POST", b));
  assert.equal(w.status, "queued");
  await runtime.worker!.market!.execute(owner, w.id);
  const done = check("Work", await call("market/work", "POST", b));
  assert.equal(done.status, "succeeded");
  check("Work", await call("market/work/" + w.id));
  const data = check(
    "Snapshot",
    await call("market/snapshots/" + done.snapshot_id),
  );
  assert.equal(data.dataset.bars[0].amount_cny, "9007199254740993.0000000001");
  check("Page", await call("market/snapshots"));
  assert.deepEqual(await runtime.repository.investments.accounts(owner), []);
  assert.equal(
    (
      await call(
        "market/snapshots/" + done.snapshot_id,
        "GET",
        undefined,
        "unused",
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("market/work", "POST", { ...b, csv: b.csv + "\n" })).statusCode,
    409,
  );
  const second = check(
    "Work",
    await call("market/work", "POST", b, "market-http-cancel-source"),
  );
  check(
    "Work",
    await call(
      "market/work/" + second.id + "/cancel",
      "POST",
      { base_revision: 1 },
      "market-http-cancel",
    ),
  );
  await runtime.worker!.market!.execute(owner, second.id);
  assert.equal(
    check("Work", await call("market/work/" + second.id)).status,
    "cancelled",
  );
  const disabled = check(
    "Work",
    await call(
      "market/work",
      "POST",
      {
        instrument_id: b.instrument_id,
        base_revision: 1,
        supplier: "eastmoney",
        start: b.start,
        end: b.end,
      },
      "market-http-disabled",
    ),
  );
  await runtime.worker!.market!.execute(owner, disabled.id);
  assert.equal(
    check("Work", await call("market/work/" + disabled.id)).error_code,
    "SUPPLIER_DISABLED",
  );
  assert.equal(
    (
      await call(
        "market/work",
        "POST",
        { ...b, token: "DO_NOT_SEND_SERVER_CREDENTIALS" },
        "market-http-forbidden-token",
      )
    ).statusCode,
    422,
  );
  for(const start of ['bad-date','2026-02-30',42])assert.equal((await call('market/work','POST',{...b,start},'market-http-invalid-date-'+String(start))).statusCode,422);

});
