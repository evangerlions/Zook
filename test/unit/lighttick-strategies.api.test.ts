import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { strategyFixture } from "../support/lighttick-strategy-fixture.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
test("strategy/backtest canonical HTTP validates frozen reports, pagination and no-store; scope and task-only compatibility stay intact", async () => {
  const f = await strategyFixture(undefined, "user_alice"),
    seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "strategy-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({
      seed,
      lighttickEnabled: true,
      lighttickRepository: f.repo,
    }),
    ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "strategy-api-original",
    user = "user_alice",
    query?: Record<string, string>,
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/investments/" + path,
      body,
      query,
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
    assert.equal(r.headers["Cache-Control"], "no-store");
    const v = ajv.compile(
      (schemas as any)["LightTickInvestmentStrategy" + name + "EnvelopeSchema"],
    );
    assert.ok(v(JSON.parse(JSON.stringify(r.body))), JSON.stringify(v.errors));
    return r.body.data;
  };
  check("Catalog", await call("strategies/catalog"));
  check("DefinitionPage", await call("strategies"));
  check("Definition", await call("strategies/" + f.d.id));
  check("Definition", await call("strategies/" + f.d.id + "/versions/1"));
  check("History", await call("strategies/" + f.d.id + "/history"));
  const created = check("Work", await call("backtests", "POST", f.body));
  await app.services.lighttickRuntime!.worker!.strategies!.execute(
    f.o,
    created.id,
  );
  const done = check("Work", await call("backtests/" + created.id));
  assert.equal(done.status, "succeeded");
  assert.equal(done.output.status, "complete");
  assert.equal(done.input.snapshot.dataset.bars, undefined);
  assert.equal(done.output.cases[0].result.equity, undefined);
  check("RunPage", await call("backtests"));
  const page = check(
    "CasePage",
    await call(
      "backtests/" + created.id + "/cases/0",
      "GET",
      undefined,
      undefined,
      undefined,
      { section: "equity", limit: "2" },
    ),
  );
  assert.ok(page.next_cursor);
  check(
    "CasePage",
    await call(
      "backtests/" + created.id + "/cases/0",
      "GET",
      undefined,
      undefined,
      undefined,
      { section: "equity", limit: "2", cursor: page.next_cursor },
    ),
  );
  check(
    "CasePage",
    await call(
      "backtests/" + created.id + "/cases/0",
      "GET",
      undefined,
      undefined,
      undefined,
      { section: "trades" },
    ),
  );
  check(
    "CasePage",
    await call(
      "backtests/" + created.id + "/cases/0",
      "GET",
      undefined,
      undefined,
      undefined,
      { section: "orders" },
    ),
  );
  const original = check("Work", await call("backtests", "POST", f.body));
  assert.equal(original.id, created.id);
  assert.equal(original.status, "succeeded");
  assert.equal(
    (
      await call(
        "backtests/" + created.id,
        "GET",
        undefined,
        undefined,
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call("backtests", "POST", {
        ...f.body,
        instrument_id: "inv-other-instrument",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "backtests/" + created.id + "/cases/0",
        "GET",
        undefined,
        undefined,
        undefined,
        { section: "eval(code)" },
      )
    ).statusCode,
    422,
  );
  const second = check(
    "Work",
    await call(
      "backtests",
      "POST",
      { ...f.body, execution_review: null },
      "second-api-original",
    ),
  );
  check(
    "Work",
    await call(
      "backtests/" + second.id + "/cancel",
      "POST",
      { base_revision: 1 },
      "api-cancel-original",
    ),
  );
  const exported = await f.repo.transaction(f.o, () =>
    import("../../src/modules/lighttick/investments/ledger.export.ts").then(
      (m) => m.exportInvestments(f.repo, f.o),
    ),
  );
  const runs = exported.strategies!.runs;
  assert.equal(runs.length, 2);
  assert.equal(runs[0].input.snapshot.dataset.bars.length, 4);
  assert.equal(JSON.stringify(exported).includes('"lease_until"'), false);
  assert.equal(JSON.stringify(exported).includes('"fence"'), false);
  assert.equal(runs.find((w) => w.id === second.id)!.commands.length, 2);
});
