import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as contracts from "../../src/generated/openapi/public-contracts.generated.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { AccountReportService } from "../../src/modules/lighttick/account-reports/account-report.service.ts";
import { AccountReportRunner } from "../../src/modules/lighttick/account-reports/account-report.runner.ts";
import { LightTickRecordService } from "../../src/modules/lighttick/lighttick-record.service.ts";
import { emptyFormRecords } from "../../src/modules/lighttick/form-records/form-records.service.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_reports_")
)
  throw Error("Disposable reports database required.");
test("PostgreSQL reports: profile timezone, frozen facts, idempotency, worker output, rollback, owner isolation, core recovery and deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    owner = { appId: "lighttick" as const, userId: "reports-" + randomUUID() };
  const clock = () => new Date("2026-11-14T18:00:00Z");
  const service = new AccountReportService(
    repo,
    { add: async () => ({}) } as any,
    async () => {},
    clock,
  );
  const records = new LightTickRecordService(repo, clock);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(
    contracts.LightTickAccountReportDetailEnvelopeSchema,
  );
  const check = (data: unknown) =>
    assert.equal(
      validate({ code: "OK", message: "", requestId: "fixture", data }),
      true,
      JSON.stringify(validate.errors),
    );
  try {
    await repo.saveProfile({
      ...owner,
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
      pace: "balanced",
      onboardingState: "none",
      notificationPreferences: {},
      onboardingDraft: {},
      version: 1,
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    });
    await records.mutate(
      owner,
      "record-report-0001",
      "save",
      {
        base_version: 0,
        raw_text: "private raw text never sent to model",
        record_date: "2026-11-15",
      },
      "record-report-save-0001",
    );
    await records.mutate(
      owner,
      "record-report-0002",
      "save",
      { base_version: 0, raw_text: "future record", record_date: "2026-11-16" },
      "record-report-save-0002",
    );
    const forms = emptyFormRecords();
    forms.modules = [
      { id: "growth", name: "Growth", color: "#123456", order: 0 },
    ];
    forms.checkins = { "2026-11-15": { growth: 1 } };
    forms.habits = { "2026-11-15": { minutes: 25, note: "secret habit" } };
    await repo.formRecords.save(
      owner,
      { revision: 1, data: forms, updated_at: clock().toISOString() },
      0,
    );
    const reading = new ReadingService(repo, clock);
    await reading.create(owner, {
      url: "https://example.com/report",
      title: "Reading evidence",
      summary: "private summary",
    });
    const input = {
      request_key: "report-pg-request-0001",
      period_days: 7,
      mode: "facts",
    };
    const result = await Promise.all(
      Array.from({ length: 4 }, () => service.create(owner, input)),
    );
    check(result[0]);
    assert.equal(new Set(result.map((r) => r.id)).size, 1);
    assert.equal(result[0].facts!.end, "2026-11-15");
    assert.equal(result[0].facts!.start, "2026-11-09");
    assert.equal(
      result[0].facts!.metrics.find((m) => m.key === "record")!.count,
      1,
    );
    assert.equal(result[0].facts!.active_days, 1);
    assert.equal(result[0].facts!.durations[0].minutes, 25);
    assert.equal(JSON.stringify(result[0]).includes("private raw text"), false);
    assert.equal(JSON.stringify(result[0]).includes("secret habit"), false);
    await records.mutate(
      owner,
      "record-report-0003",
      "save",
      { base_version: 0, raw_text: "later record", record_date: "2026-11-15" },
      "record-report-save-0003",
    );
    assert.equal(
      (await service.get(owner, result[0].id)).facts!.metrics.find(
        (m) => m.key === "record",
      )!.count,
      1,
    );
    await assert.rejects(
      repo.transaction(owner, async () => {
        await service.create(owner, {
          ...input,
          request_key: "report-pg-rollback",
        });
        throw Error("rollback");
      }),
    );
    await assert.rejects(() => service.byRequest(owner, "report-pg-rollback"), {
      statusCode: 404,
    });
    const ai = await service.create(owner, {
      request_key: "report-pg-ai-001",
      period_days: 7,
      mode: "ai",
    });
    const runner = new AccountReportRunner(service, {
      complete: async (request) => {
        assert.equal(
          JSON.stringify(request.messages).includes("private raw text"),
          false,
        );
        return {
          text: JSON.stringify({
            overview: "本期仅反映已保存记录。",
            observations: [
              { text: "已保存两条记录。", evidence_keys: ["record"] },
            ],
            suggestions: ["选择一个可验证的小实验。"],
            limitations: "单个周期不能判断趋势。",
          }),
          finishReason: "stop",
          provider: "synthetic",
          providerModel: "synthetic-report",
        };
      },
    } as any);
    await runner.execute(owner, ai.id);
    const ready = await service.get(owner, ai.id);
    check(ready);
    assert.equal(ready.status, "ready");
    assert.equal(
      ready.facts!.metrics.find((m) => m.key === "record")!.count,
      2,
    );
    const reopened = new AccountReportService(
      new PostgresLightTickRepository(pool),
    );
    assert.equal(
      (await reopened.get(owner, ai.id)).output!.overview,
      ready.output!.overview,
    );
    assert.equal(
      (await service.list({ ...owner, userId: "reports-bob" }, {})).total,
      0,
    );
    await assert.rejects(
      () => service.get({ ...owner, userId: "reports-bob" }, ai.id),
      { statusCode: 404 },
    );
    await service.mutate(owner, ai.id, "delete", {
      base_version: ready.revision,
    });
    assert.equal(
      (await service.byRequest(owner, "report-pg-ai-001")).facts,
      null,
    );
    assert.equal(
      (
        await service.create(owner, {
          request_key: "report-pg-ai-001",
          period_days: 7,
          mode: "ai",
        })
      ).status,
      "deleted",
    );
  } finally {
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});
