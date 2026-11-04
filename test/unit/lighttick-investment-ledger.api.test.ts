import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
test("ledger HTTP contracts expose queued/terminal/cancelled receipts, CAS pages and original request identity", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "ledger-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    runtime = app.services.lighttickRuntime!,
    ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "ledger-http-original",
    user = "user_alice",
  ) =>
    app.app.handle({
      path: "/api/v1/lighttick/investments/" + path,
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
  const check = (kind: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const validate = ajv.compile(
      (schemas as any)["LightTickInvestment" + kind + "EnvelopeSchema"],
    );
    assert.equal(
      validate(JSON.parse(JSON.stringify(r.body))),
      true,
      JSON.stringify(validate.errors),
    );
    return r.body.data;
  };
  const root = "accounts/inv-ledger-http-fixture";
  check(
    "Account",
    await call(
      root,
      "PUT",
      {
        base_revision: 0,
        name: "Synthetic",
        currency: "CNY",
        baseline_date: "2026-01-01",
        opening_cash: "0.1",
        opening_positions: [],
      },
      "ledger-http-account",
    ),
  );
  const b = {
      base_revision: 1,
      business_date: "2026-01-01",
      kind: "cash",
      cash: { kind: "deposit", amount: "0.0000000001" },
    },
    w = check("LedgerWork", await call(root + "/events", "POST", b));
  assert.equal(w.status, "queued");
  await runtime.worker!.investments!.execute(
    { appId: "lighttick", userId: "user_alice" },
    w.id,
  );
  const terminal = check("LedgerWork", await call(root + "/events", "POST", b));
  assert.equal(terminal.status, "succeeded");
  assert.equal(terminal.output.result.cash, "0.1000000001");
  check("LedgerWork", await call("work/" + w.id));
  const page = check("LedgerPage", await call(root + "/ledger"));
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].input.cash.amount, "0.0000000001");
  assert.equal(
    (await call("work/" + w.id, "GET", undefined, "unused", "user_bob"))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        root + "/events",
        "POST",
        { ...b, base_revision: 2 },
        "ledger-http-original",
      )
    ).statusCode,
    409,
  );
  const next = check(
    "LedgerWork",
    await call(
      root + "/events",
      "POST",
      { ...b, base_revision: 2 },
      "ledger-http-second",
    ),
  );
  const cancel = check(
    "LedgerWork",
    await call(
      "work/" + next.id + "/cancel",
      "POST",
      { base_revision: next.revision },
      "ledger-http-cancel",
    ),
  );
  assert.equal(cancel.status, "cancelled");
  await runtime.worker!.investments!.execute(
    { appId: "lighttick", userId: "user_alice" },
    next.id,
  );
  assert.equal(
    check(
      "LedgerWork",
      await call(
        root + "/events",
        "POST",
        { ...b, base_revision: 2 },
        "ledger-http-second",
      ),
    ).status,
    "cancelled",
  );
  assert.equal(
    (
      await call(
        root + "/events",
        "POST",
        { ...b, base_revision: 2, cash: { kind: "deposit", amount: 0.1 } },
        "ledger-http-float",
      )
    ).statusCode,
    422,
  );
});
