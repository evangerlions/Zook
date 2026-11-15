import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { CalendarService } from "../../src/modules/lighttick/calendar/calendar.service.ts";
import { LightTickCalendarEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { seedCalendar } from "../support/calendar-fixture.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_calendar_")
)
  throw Error("Dedicated localhost calendar database required");
test("real owner calendar combines native sources without writes, retains original versions, enforces auth and survives reconnect", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "user_alice" };
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    ...o,
    id: "calendar-alice",
    status: "ACTIVE",
    accountRegion: "CN",
    joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({
    seed,
    lighttickEnabled: true,
    lighttickRepository: repo,
  });
  try {
    await repo.deleteOwnerData(o);
    const f = await seedCalendar(app, repo, pool),
      service = new CalendarService(repo);
    const fingerprint = async () =>
      JSON.stringify(
        (
          await pool.query(
            "SELECT id,version,status FROM zook_lighttick_tasks WHERE app_id=$1 AND user_id=$2 ORDER BY id",
            [o.appId, o.userId],
          )
        ).rows,
      );
    const before = await fingerprint();
    const v = await service.read(o, { month: f.month });
    assert.equal(v.sources.length, 6);
    assert.ok(v.sources.every((s) => s.count > 0));
    assert.ok(v.unknown_date_count >= 1);
    assert.equal(v.total, 33);
    assert.equal(v.pages, 2);
    const lessons = await service.read(o, {
      month: f.month,
      source: "learning",
    });
    assert.equal(lessons.total, 1);
    assert.match(lessons.items[0].href, new RegExp(f.old_version));
    assert.equal(lessons.items[0].status, "historical");
    assert.equal(lessons.items[0].date, f.month + "-01");
    const focus = await service.read(o, { month: f.month, source: "focus" });
    assert.equal(focus.total, 2);
    assert.equal(
      focus.items.find((i) => i.kind === "focus_saved")?.minutes,
      0.75,
    );
    assert.equal(
      focus.items.find((i) => i.kind === "break_saved")?.minutes,
      0.5,
    );
    const tasks = await service.read(o, { month: f.month, source: "tasks" });
    assert.equal(tasks.total, 3);
    assert.equal(
      tasks.days.find((d) => d.date === f.today.business_date)?.scheduled,
      2,
    );
    const read = await service.read(o, { month: f.month, source: "reading" });
    assert.equal(read.total, 2);
    const records = await service.read(o, {
      month: f.month,
      source: "records",
      page: "9",
    });
    assert.equal(records.page, 2);
    assert.equal(records.items.length, 3);
    assert.equal(
      (
        await service.read(
          { appId: "lighttick", userId: "calendar-empty-owner" },
          { month: f.month },
        )
      ).total,
      0,
    );
    assert.equal(await fingerprint(), before);
    const workspace = (await repo.getActionWorkspace(o))!;
    workspace.data.records[0].outcome = "completed";
    workspace.data.records[0].completion_effect = "complete";
    workspace.data.records.push({
      ...workspace.data.records[0],
      id: "calendar-reversal",
      record_kind: "reversal",
      completion_effect: "reopen",
      outcome: "reopened",
      reverses_record_id: "calendar-session",
      actual_minutes: 0,
    });
    await repo.saveActionWorkspace({
      ...workspace,
      version: workspace.version + 1,
    });
    const reversed = await service.read(o, {
      month: f.month,
      source: "actions",
    });
    assert.equal(reversed.total, 2);
    assert.equal(
      reversed.items.find((i) => i.kind === "action_session")?.minutes,
      3,
    );
    assert.equal(
      reversed.items.find((i) => i.kind === "action_session")?.status,
      "reopened",
    );
    const a = await repo.getLearningAuthority(o);
    await repo.saveLearningAuthority(
      { ...a!, privateEnabled: false, revision: a!.revision + 1 },
      a!.revision,
    );
    const limited = await service.read(o, {
      month: f.month,
      source: "learning",
    });
    assert.equal(limited.total, 0);
    assert.equal(limited.coverage[0].status, "partial");
    await repo.saveLearningAuthority(
      { ...a!, readingEnabled: false, revision: a!.revision + 2 },
      a!.revision + 1,
    );
    assert.equal(
      (await service.read(o, { month: f.month, source: "reading" })).coverage[0]
        .status,
      "not_authorized",
    );
    const token = app.services.tokenService.issueAccessToken(
      o.userId,
      "lighttick",
    );
    const call = (
      method: string,
      query: any = {},
      headers: any = {
        authorization: "Bearer " + token,
        "x-app-id": "lighttick",
      },
    ) =>
      app.app.handle({
        method,
        path: "/api/v1/lighttick/calendar",
        headers,
        query,
      });
    const config = JSON.parse(
      (await app.services.appConfigService.getValue(
        "lighttick",
        "admin.delivery_config",
      ))!,
    );
    config.settings.runtimeScope = "core";
    await app.services.appConfigService.setValue(
      "lighttick",
      "admin.delivery_config",
      JSON.stringify(config),
    );
    const http: any = await call("GET", { month: f.month });
    assert.equal(http.statusCode, 200);
    assert.equal(
      http.headers["Cache-Control"] ?? http.headers["cache-control"],
      "no-store",
    );
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(LightTickCalendarEnvelopeSchema);
    assert.ok(validate(http.body), JSON.stringify(validate.errors));
    assert.equal((await call("POST")).statusCode, 405);
    assert.equal(
      (await call("GET", { month: "2026-02", day: "2026-02-30" })).statusCode,
      422,
    );
    assert.equal((await call("GET", {}, {})).statusCode, 401);
    const guest: any = await app.app.handle({
      method: "POST",
      path: "/api/v1/lighttick/account/guest-sessions",
      headers: { "idempotency-key": "calendar-guest-create" },
      ipAddress: "127.0.0.1",
      body: {
        device_id: "calendar-guest-device",
        device_secret: "synthetic-calendar-device-secret-long-enough",
        platform: "ios",
        timezone: "UTC",
        locale: "zh-CN",
        app_version: "1.0.0",
      },
    });
    assert.equal(guest.statusCode, 201, JSON.stringify(guest.body));
    assert.equal(
      (
        await call(
          "GET",
          {},
          {
            authorization: "Bearer " + guest.body.data.access_token,
            "x-app-id": "lighttick",
          },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await call(
          "GET",
          {},
          {
            authorization:
              "Bearer " +
              app.services.tokenService.issueAccessToken(o.userId, "bodylog"),
            "x-app-id": "bodylog",
          },
        )
      ).statusCode,
      403,
    );
    const second = new Pool({ connectionString: dsn });
    try {
      assert.equal(
        (
          await new CalendarService(
            new PostgresLightTickRepository(second),
          ).read(o, { month: f.month })
        ).total,
        32,
      );
    } finally {
      await second.end();
    }
    assert.equal(await fingerprint(), before);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});
