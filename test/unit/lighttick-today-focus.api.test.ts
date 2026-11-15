import { test } from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickTodayFocusEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { seedTodayFocus } from "../support/today-focus-fixture.ts";
test("today focus HTTP core, contract, task lifecycle, auth, owner isolation and immutable receipts", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "daily-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const config = seed.appConfigs.find(
      (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
    )!,
    cfg = JSON.parse(config.configValue);
  config.configValue = JSON.stringify({
    ...cfg,
    settings: { ...cfg.settings, runtimeScope: "core" },
  });
  const runtime = await createApplication({ seed, lighttickEnabled: true }),
    f = await seedTodayFocus(runtime);
  const initial = await f.call("GET", "today/focus");
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.headers["Cache-Control"], "no-store");
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickTodayFocusEnvelopeSchema);
  assert.equal(
    validate(JSON.parse(JSON.stringify(initial.body))),
    true,
    JSON.stringify(validate.errors),
  );
  const t = f.tasks[1],
    b = {
      request_key: "daily-api-select",
      base_version: 0,
      business_date: f.today.business_date,
      timezone: f.today.timezone,
      task_id: t.id,
      task_version: t.version,
      success_criterion: "练完一段",
      first_step: "打开草稿",
    };
  assert.equal(
    (await f.call("PUT", "today/focus", b)).body.data.status,
    "active",
  );
  assert.equal((await f.ok("GET", "today")).completed_tasks.length, 0);
  const finished = await f.ok("POST", "tasks/" + t.id + "/complete", {
    base_version: t.version,
  });
  assert.equal(finished.status, "completed");
  assert.equal((await f.ok("GET", "today/focus")).status, "completed");
  assert.equal(
    (await f.ok("GET", "today/focus/requests/daily-api-select")).status,
    "active",
  );
  assert.equal(
    (
      await f.call("PUT", "today/focus", {
        ...b,
        request_key: "daily-api-stale",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await f.call("GET", "today/focus", undefined, undefined, "user_bob")).body
      .data.revision,
    0,
  );
  assert.equal(
    (
      await f.call(
        "GET",
        "today/focus/requests/daily-api-select",
        undefined,
        undefined,
        "user_bob",
      )
    ).statusCode,
    404,
  );
  const noauth = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/lighttick/today/focus",
    headers: { "x-app-id": "lighttick" },
  });
  assert.equal(noauth.statusCode, 401);
});
