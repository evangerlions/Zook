import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
test("screening HTTP uses actual attached worker, no-store owner CAS contracts and exact source explanations", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "screen-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  seed.users.push({
    ...seed.users[0],
    id: "screen_unjoined",
    email: "screen-unjoined@example.invalid",
  });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "screen-original",
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
    const validate = ajv.compile(
      (schemas as any)["LightTickInvestmentScreen" + name + "EnvelopeSchema"],
    );
    assert.ok(
      validate(JSON.parse(JSON.stringify(r.body))),
      JSON.stringify(validate.errors),
    );
    return r.body.data;
  };
  check("Catalog", await call("screening/catalog"));
  const m = { source: "manual", quote: "", reason: "" },
    fields = {
      name: "Rule",
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
      sort_mapping: m,
    },
    rid = "inv-http-screen-rule",
    tid = "inv-http-screen-template";
  const rule = check(
    "Definition",
    await call(
      "screening/rules/" + rid,
      "PUT",
      { base_revision: 0, fields },
      "rule-original",
    ),
  );
  const i: any = (
    await call(
      "instruments",
      "POST",
      { market: "SSE", code: "600000", kind: "stock", name: "Synthetic" },
      "symbol-original",
    )
  ).body;
  const template = {
    name: "Template",
    description: "",
    rule: { id: rid, version: 1, definition_digest: rule.definition_digest },
    instrument_ids: [i.data.instrument.id],
    account_id: null,
    enabled: true,
    tags: [],
  };
  check(
    "Definition",
    await call(
      "screening/templates/" + tid,
      "PUT",
      { base_revision: 0, fields: template },
      "template-original",
    ),
  );
  check("DefinitionPage", await call("screening/rules"));
  check("History", await call("screening/rules/" + rid + "/history"));
  check("Definition", await call("screening/rules/" + rid + "/versions/1"));
  const body = {
    template_id: tid,
    base_revision: 1,
    as_of: "2026-11-06",
    decision_at: "2026-11-06T16:00:00+08:00",
    sources: [
      {
        instrument_id: i.data.instrument.id,
        snapshot_id: null,
        input_digest: null,
        security_status: null,
      },
    ],
    consent: true,
  };
  const work = check(
    "Work",
    await call("screening/runs", "POST", body, "run-original"),
  );
  await app.services.lighttickRuntime!.worker!.screening!.execute(
    { appId: "lighttick", userId: "user_alice" },
    work.id,
  );
  const done = check("Work", await call("screening/runs/" + work.id));
  assert.equal(done.status, "succeeded");
  assert.equal(done.output.unresolved, 1);
  assert.equal(done.output.evaluations[0].source.snapshot_id, null);
  assert.ok(!JSON.stringify(done).includes("lease_until"));
  assert.equal(
    check("Work", await call("screening/runs", "POST", body, "run-original"))
      .id,
    work.id,
  );
  check("RunPage", await call("screening/runs"));
  assert.equal(
    (
      await call(
        "screening/runs/" + work.id,
        "GET",
        undefined,
        "foreign-read",
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "screening/catalog",
        "GET",
        undefined,
        "unjoined-read",
        "screen_unjoined",
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "screening/rules/" + rid,
        "PUT",
        {
          base_revision: 1,
          fields: {
            ...fields,
            conditions: [
              {
                field: "__proto__",
                op: "gt",
                value: "1",
                upper_value: null,
                mapping: m,
              },
            ],
          },
        },
        "bad-field",
      )
    ).statusCode,
    422,
  );
  await app.database.updateAppUserStatus("lighttick", "user_alice", "BLOCKED");
  assert.equal((await call("screening/runs/" + work.id)).statusCode, 403);
});
