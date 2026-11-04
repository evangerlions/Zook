import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
test("investment account and instrument HTTP contracts are precise, owner scoped and absent from old sync", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "investor-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "investment-http-original",
    user = "user_alice",
  ) =>
    app.app.handle({
      path: "/api/v1/lighttick/" + path,
      method,
      body,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  const check = (name: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const validate = ajv.compile(
      (schemas as any)["LightTickInvestment" + name + "EnvelopeSchema"],
    );
    assert.equal(
      validate(JSON.parse(JSON.stringify(r.body))),
      true,
      JSON.stringify(validate.errors),
    );
    return r.body.data;
  };
  const i = check(
    "InstrumentCreate",
    await call("investments/instruments", "POST", {
      market: "SSE",
      kind: "stock",
      code: "600000.SH",
      name: "Synthetic symbol",
    }),
  );
  check("Instruments", await call("investments/instruments"));
  check("Instrument", await call("investments/instruments/" + i.instrument.id));
  const body = {
      base_revision: 0,
      name: "Synthetic opening",
      currency: "CNY",
      baseline_date: "2026-11-04",
      opening_cash: "0.1000000000",
      opening_positions: [
        {
          instrument_id: i.instrument.id,
          quantity: "0.0000000001",
          cost: null,
        },
      ],
    },
    root = "investments/accounts/inv-http-account-fixture";
  const account = check(
    "Account",
    await call(root, "PUT", body, "investment-http-account"),
  );
  assert.equal(account.opening_cash, "0.1");
  assert.equal(account.opening_positions[0].cost, null);
  check("Accounts", await call("investments/accounts"));
  assert.equal(
    (await call(root, "GET", undefined, "unused", "user_bob")).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        root,
        "PUT",
        { ...body, opening_cash: 0.1 },
        "investment-http-float",
      )
    ).statusCode,
    422,
  );
  check(
    "Account",
    await call(
      root + "/status",
      "POST",
      { base_revision: 1, archived: true },
      "investment-http-archive",
    ),
  );
  check(
    "Instrument",
    await call(
      "investments/instruments/" + i.instrument.id,
      "PUT",
      { base_revision: 1, name: "Updated synthetic name", archived: false },
      "investment-http-symbol-update",
    ),
  );
  const pull = await call("sync/pull");
  assert.equal(JSON.stringify(pull.body).includes(i.instrument.id), false);
  assert.equal(
    JSON.stringify(pull.body).includes("inv-http-account-fixture"),
    false,
  );
});
