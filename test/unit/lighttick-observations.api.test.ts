import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { observationFixture } from "../support/lighttick-observation-fixture.ts";
test("observation canonical HTTP uses actual worker contracts no-store membership isolation frozen outcomes and stable original identity", async () => {
  const f = await observationFixture(undefined, "user_alice"),
    seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "observe-" + userId,
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
    key = "observation-original",
    user = "user_alice",
    query?: Record<string, string>,
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/investments/observations/" + path,
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
      (schemas as any)[
        "LightTickInvestmentObservation" + name + "EnvelopeSchema"
      ],
    );
    assert.ok(v(JSON.parse(JSON.stringify(r.body))), JSON.stringify(v.errors));
    return r.body.data;
  };
  check("Catalog", await call("catalog"));
  check("Entry", await call("predictions/" + f.pid));
  check("Page", await call("predictions"));
  check("Page", await call("predictions/" + f.pid + "/history"));
  const ruleId = "inv-preview-rule-fixture";
  const rule = await app.services.lighttickRuntime!.screening!.writeDefinition(
    f.o,
    "rules",
    ruleId,
    {
      base_revision: 0,
      fields: {
        name: "Source rule",
        description: "",
        source_text: "",
        conditions: [],
        combine: "all",
        sort_by: "close",
        descending: true,
        secondary_sort_by: null,
        secondary_descending: true,
        limit: 20,
        recipe: null,
        sort_mapping: { source: "manual", quote: "", reason: "" },
      },
    },
    "preview-rule-original",
  );
  const preview = check(
    "SourcePreview",
    await call(
      "source-preview",
      "GET",
      undefined,
      "unused-original",
      "user_alice",
      {
        kind: "screen_rule",
        id: ruleId,
        version: "1",
        instrument_id: f.instrument.id,
      },
    ),
  );
  assert.equal(preview.ref.digest, rule.definition_digest);
  const b = {
      ...f.evaluationBody,
      corporate_action_review: {
        unchanged: true,
        source_label: "Synthetic interval declaration",
        available_at: f.evaluationBody.decision_at,
      },
    },
    w = check(
      "Work",
      await call(
        "predictions/" + f.pid + "/evaluate",
        "POST",
        b,
        "http-evaluation-original",
      ),
    );
  await app.services.lighttickRuntime!.worker!.observations!.execute(f.o, w.id);
  const done = check("Work", await call("work/" + w.id));
  assert.equal(done.status, "succeeded");
  assert.equal(done.output.outcomes[0].correct, true);
  assert.equal(done.input.prediction.frozen.snapshot.dataset.bars, undefined);
  assert.equal(
    check(
      "Work",
      await call(
        "predictions/" + f.pid + "/evaluate",
        "POST",
        b,
        "http-evaluation-original",
      ),
    ).id,
    w.id,
  );
  check("WorkPage", await call("work"));
  check("Calibration", await call("calibration"));
  const fb = {
    base_revision: 0,
    fields: {
      prediction_id: f.pid,
      evaluation_id: w.id,
      horizon: 1,
      reflection: "Explicit reflection",
      learned: "Uncertainty",
      next_step: "",
    },
    consent: true,
  };
  check(
    "Entry",
    await call(
      "feedback/inv-http-feedback",
      "PUT",
      fb,
      "http-feedback-original",
    ),
  );
  const m = check(
    "Entry",
    await call(
      "monitors/inv-http-monitor",
      "PUT",
      { base_revision: 0, fields: f.monitorFields, consent: true },
      "http-monitor-original",
    ),
  );
  const mw = check(
    "Work",
    await call(
      "monitors/" + m.id + "/check",
      "POST",
      {
        base_revision: 1,
        snapshot_id: f.daily.id,
        input_digest: f.daily.dataset.input_digest,
        consent: true,
      },
      "http-check-original",
    ),
  );
  await app.services.lighttickRuntime!.worker!.observations!.execute(
    f.o,
    mw.id,
  );
  check("Work", await call("work/" + mw.id));
  check(
    "Entry",
    await call(
      "monitors/" + m.id + "/stop",
      "POST",
      { base_revision: 1 },
      "http-stop-original",
    ),
  );
  assert.equal(
    (
      await call(
        "predictions/" + f.pid,
        "GET",
        undefined,
        "unused-original",
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "work/" + w.id,
        "GET",
        undefined,
        "unused-original",
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "monitors/" + m.id + "/check",
        "POST",
        { base_revision: 2, consent: true },
        "http-stopped-original",
      )
    ).statusCode,
    409,
  );
  const membership = seed.appUsers.find(
    (m) => m.userId === "user_alice" && m.appId === "lighttick",
  )!;
  await app.database.updateAppUserStatus("lighttick", "user_alice", "BLOCKED");
  assert.equal((await call("catalog")).statusCode, 403);
});
