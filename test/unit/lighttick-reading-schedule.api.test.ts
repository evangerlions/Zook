import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
test("HTTP daily reading opt-in, state/history, source-only worker recovery and core stop receipts satisfy generated contracts", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "candidate-http-member",
    appId: "lighttick",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: new Date().toISOString(),
  });
  const runtime = await createApplication({ seed, lighttickEnabled: true }),
    headers = {
      authorization:
        "Bearer " +
        runtime.services.tokenService.issueAccessToken(
          "user_alice",
          "lighttick",
        ),
      "x-app-id": "lighttick",
    },
    ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const call = (
      path: string,
      method = "GET",
      body?: unknown,
      key = "candidate-http-original",
    ) =>
      runtime.app.handle({
        path: "/api/v1/lighttick/reading" + path,
        method,
        body,
        headers: { ...headers, "idempotency-key": key },
      }),
    check = (name: string, r: any) => {
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));
      const validate = ajv.compile(
        (schemas as any)["LightTickReading" + name + "Schema"],
      );
      assert.ok(validate(r.body), JSON.stringify(validate.errors));
      return r.body.data;
    };
  const owner = { appId: "lighttick" as const, userId: "user_alice" },
    work = runtime.services.lighttickRuntime.readingWork!;
  check("ScheduleEnvelope", await call("/schedule"));
  const { seedReadingRecommendation } = await import(
    "../support/reading-recommendation-fixture.ts"
  );
  await seedReadingRecommendation(work, owner, 1);
  const preferences = check("PreferencesEnvelope", await call("/preferences"));
  check(
    "PreferencesEnvelope",
    await call(
      "/preferences",
      "PUT",
      {
        base_revision: preferences.revision,
        value: { ...preferences.value, enabled: true, hour: 0, minute: 0 },
      },
      "daily-http-enable",
    ),
  );
  const runner = new ReadingWorkRunner(
    work,
    {
      complete: async () => {
        throw Error("No paid model");
      },
    } as any,
    async () => {
      throw Error("Recover cannot fetch sources");
    },
    async () => runtime.services.lighttickRuntime.scopePolicy.assertFull(),
  );
  await runner.recover();
  const scheduled = check("ScheduleEnvelope", await call("/schedule")),
    day = scheduled.day;
  assert.ok(day);
  assert.equal(day.attempts, 1);
  const ready = check("WorkEnvelope", await call("/work/" + day.work_id));
  assert.equal(ready.scope.scheduled.date, day.date);
  assert.equal(ready.scope.scheduled.target_count, 1);
  assert.equal(ready.status, "queued");
  check("SchedulePageEnvelope", await call("/schedule/history"));
  check("ExportEnvelope", await call("/export"));
  await runtime.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  const stopped = check(
    "ScheduleDayEnvelope",
    await call(
      "/schedule/" + day.date + "/stop",
      "POST",
      { base_revision: day.revision },
      "daily-http-stop",
    ),
  );
  assert.equal(stopped.phase, "stopped");
  assert.equal(
    check("WorkEnvelope", await call("/work/" + day.work_id)).status,
    "cancelled",
  );
  const receipt = check(
    "WorkReceiptEnvelope",
    await call("/work-receipts/daily-http-stop"),
  );
  assert.deepEqual(receipt.result, stopped);
  assert.deepEqual(
    check(
      "ScheduleDayEnvelope",
      await call(
        "/schedule/" + day.date + "/stop",
        "POST",
        { base_revision: day.revision },
        "daily-http-stop",
      ),
    ),
    stopped,
  );
  assert.equal(
    (
      await call(
        "/preferences",
        "PUT",
        { base_revision: 2, value: preferences.value },
        "daily-http-core-prefs",
      )
    ).statusCode,
    503,
  );
  const disabled = check(
    "PreferencesEnvelope",
    await call(
      "/preferences/disable",
      "POST",
      { base_revision: 2 },
      "daily-http-disable-future",
    ),
  );
  assert.equal(disabled.value.enabled, false);
  assert.equal(disabled.revision, 3);
  assert.deepEqual(
    check(
      "WorkReceiptEnvelope",
      await call("/work-receipts/daily-http-disable-future"),
    ).result,
    disabled,
  );
});
