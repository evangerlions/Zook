import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { emptyFormRecords } from "../../src/modules/lighttick/form-records/form-records.service.ts";
import {
  LightTickFormEnvelopeSchema,
  LightTickFormExportEnvelopeSchema,
} from "../../src/generated/openapi/public-contracts.generated.ts";
test("form HTTP validates strict contracts, owner boundary and independent export/clear scope", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "forms-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    ajv = new Ajv({ strict: false });
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "forms-http-original",
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
  const saved = await call("form-records", "PUT", {
    base_revision: 0,
    data: emptyFormRecords(),
  });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(ajv.compile(LightTickFormEnvelopeSchema)(saved.body), true);
  assert.equal(saved.headers?.["Cache-Control"], "no-store");
  const exported = await call("form-records/export");
  assert.equal(
    ajv.compile(LightTickFormExportEnvelopeSchema)(exported.body),
    true,
  );
  const full = JSON.parse((await call("review/export")).body.data.content);
  assert.equal(full.form_records.revision, 1);
  assert.equal(
    (await call("form-records", "GET", undefined, "forms-other", "user_bob"))
      .body.data.revision,
    0,
  );
  assert.equal(
    (
      await call(
        "form-records",
        "PUT",
        { base_revision: 0, data: emptyFormRecords() },
        "forms-http-stale",
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "form-records/clear",
        "POST",
        { base_revision: 1, all_data: true },
        "forms-http-invalid",
      )
    ).statusCode,
    422,
  );
  const cleared = await call(
    "form-records/clear",
    "POST",
    { base_revision: 1 },
    "forms-http-clear",
  );
  assert.equal(cleared.statusCode, 200);
  assert.equal(
    JSON.stringify((await call("sync/pull")).body).includes("form_records"),
    false,
  );
  assert.equal((await call("form-records", "DELETE")).statusCode, 405);
});

test("form section HTTP retains actual fields, rejects broad writes and cannot create native execution facts", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "forms-section-alice",
    appId: "lighttick",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    ajv = new Ajv({ strict: false });
  const call = (section: string, body: unknown, key: string) =>
    app.app.handle({
      path: "/api/v1/lighttick/form-records/sections/" + section,
      method: "PATCH",
      body,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken("user_alice", "lighttick"),
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  const values: Record<string, unknown> = {
    habits: { "2026-11-08": { minutes: 15, note: "Manual only" } },
    custom: {
      customFields: [{ key: "f-count", label: "Count", type: "number" }],
      customRecords: [{ "f-count": 0 }],
    },
    decisions: [
      { date: "2026-11-08", title: "Synthetic decision", probability: 0 },
    ],
    predictions: [
      { date: "2026-11-08", statement: "Forecast", probability: "" },
    ],
    reviews: [
      {
        date: "2026-11-08",
        thought: "Before",
        action: "Text does not schedule",
      },
    ],
    insights: [
      { date: "2026-11-08", source: "Synthetic", insight: "Observation" },
    ],
    todos: [{ date: "2026-11-08", title: "Historical form todo", done: false }],
  };
  let base = 0;
  for (const [section, value] of Object.entries(values)) {
    const r = await call(
      section,
      { base_revision: base, value },
      "section-http-" + section,
    );
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(ajv.compile(LightTickFormEnvelopeSchema)(r.body), true);
    assert.equal(r.body.data.revision, ++base);
    assert.equal(r.headers?.["Cache-Control"], "no-store");
  }
  assert.equal(
    (
      await call(
        "decisions",
        { base_revision: 0, value: [] },
        "section-http-stale",
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "secrets",
        { base_revision: base, value: {} },
        "section-http-unknown",
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "reviews",
        { base_revision: base, value: [], all_sections: true },
        "section-http-broad",
      )
    ).statusCode,
    422,
  );
  const repo = app.services.lighttickRuntime!.repository,
    o = { appId: "lighttick" as const, userId: "user_alice" };
  assert.equal((await repo.listTasks(o)).length, 0);
  assert.equal((await repo.listReflections(o)).length, 0);
  const snapshot = await repo.formRecords.get(o);
  assert.equal(snapshot!.data.habits["2026-11-08"].minutes, 15);
  assert.equal(snapshot!.data.todos[0].done, false);
});
