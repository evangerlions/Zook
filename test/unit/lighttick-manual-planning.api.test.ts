import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";
import {
  LightTickManualPlanEnvelopeSchema,
  LightTickManualListEnvelopeSchema,
  LightTickLocalReceiptEnvelopeSchema,
} from "../../src/generated/openapi/public-contracts.generated.ts";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../api-contracts/fixtures/lighttick/native-manual-loop.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("manual HTTP has registered owner scope, exact schemas, Android PATCH transport, replay and independent capability", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const id of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: `manual-${id}`,
      appId: "lighttick",
      userId: id,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    runtime = app.services.lighttickRuntime;
  runtime.planningEnabled = false;
  const token = (id: string) =>
    app.services.tokenService.issueAccessToken(id, "lighttick");
  const headers = {
    "x-lighttick-task-schema": "2",
    authorization: `Bearer ${token("user_alice")}`,
  };
  const call = (
    path: string,
    method: any = "GET",
    body?: unknown,
    key = "manual-operation-one",
    h: any = headers,
  ) =>
    app.app.handle({
      path: "/api/v1/lighttick/" + path,
      method,
      body,
      headers: { ...h, "idempotency-key": key },
    });
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (s: object, v: unknown) => {
    const f = ajv.compile(s);
    assert.equal(
      f(JSON.parse(JSON.stringify(v))),
      true,
      JSON.stringify(f.errors),
    );
  };
  assert.equal(
    (await call("manual-plans", "POST", fixture.draft, "manual-no-auth", {}))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await call(
        "manual-plans",
        "POST",
        { ...fixture.draft, unreviewed_private_text: "do not upload" },
        "manual-invalid",
      )
    ).statusCode,
    422,
  );
  const created = await call("manual-plans", "POST", fixture.draft);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  check(LightTickManualPlanEnvelopeSchema, created.body);
  let p = created.body.data as any;
  assert.equal(
    (
      await runtime.repository.listTasks({
        appId: "lighttick",
        userId: "user_alice",
      })
    ).length,
    0,
  );
  assert.equal(
    (
      await call("manual-plans/" + p.id, "GET", undefined, "read", {
        authorization: `Bearer ${token("user_bob")}`,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call("today", "GET", undefined, "old-client", {
        authorization: `Bearer ${token("user_alice")}`,
      })
    ).statusCode,
    426,
  );
  const edit = await call(
    "manual-plans/" + p.id,
    "POST",
    { ...fixture.draft, base_version: p.version },
    "manual-edit-one",
    { ...headers, "x-http-method-override": "PATCH" },
  );
  assert.equal(edit.statusCode, 200, JSON.stringify(edit.body));
  check(LightTickManualPlanEnvelopeSchema, edit.body);
  p = edit.body.data;
  const command = {
    base_version: p.version,
    goal_base_version: p.goal_version,
  };
  const confirmed = await call(
    "manual-plans/" + p.id + "/confirm",
    "POST",
    command,
    "manual-confirm-one",
  );
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  check(LightTickManualPlanEnvelopeSchema, confirmed.body);
  assert.deepEqual(
    (
      await call(
        "manual-plans/" + p.id + "/confirm",
        "POST",
        command,
        "manual-confirm-one",
      )
    ).body.data,
    confirmed.body.data,
  );
  assert.equal(
    (
      await call(
        "manual-plans/" + p.id + "/confirm",
        "POST",
        command,
        "manual-confirm-two",
      )
    ).statusCode,
    409,
  );
  check(LightTickManualListEnvelopeSchema, (await call("manual-plans")).body);
  const adopted = await call(
    "local-adoptions",
    "POST",
    fixture.adoption,
    "manual-adopt-one",
  );
  assert.equal(adopted.statusCode, 200, JSON.stringify(adopted.body));
  check(LightTickLocalReceiptEnvelopeSchema, adopted.body);
  assert.deepEqual(
    (
      await call(
        "local-adoptions",
        "POST",
        fixture.adoption,
        "manual-adopt-one",
      )
    ).body.data,
    adopted.body.data,
  );
  assert.equal(
    (await runtime.repository.getAdminOperationalSummary()).ai_runs,
    0,
  );
  const guest = await call(
    "account/guest-sessions",
    "POST",
    {
      device_id: "manual-guest-device",
      device_secret: "synthetic-device-secret-0123456789",
      platform: "ios",
      timezone: "UTC",
      locale: "zh-CN",
      app_version: "1",
    },
    "manual-guest-create",
    {},
  );
  assert.equal(guest.statusCode, 201);
  assert.equal(
    (
      await call("manual-plans", "POST", fixture.draft, "manual-guest-denied", {
        authorization: `Bearer ${(guest.body.data as any).access_token}`,
      })
    ).statusCode,
    403,
  );
});
