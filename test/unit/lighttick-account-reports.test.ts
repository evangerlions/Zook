import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAccountFacts } from "../../src/modules/lighttick/account-reports/account-report.facts.ts";
import { AccountReportService } from "../../src/modules/lighttick/account-reports/account-report.service.ts";
import {
  AccountReportRunner,
  validateAccountReportOutput,
} from "../../src/modules/lighttick/account-reports/account-report.runner.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
const owner = { appId: "lighttick", userId: "user_alice" };
const clock = () => new Date("2026-11-14T18:00:00Z");
const frozen = {
  version: "account-facts-v1",
  start: "2026-11-08",
  end: "2026-11-14",
  period_days: 7,
  timezone: "UTC",
  snapshot_at: clock().toISOString(),
  active_days: 0,
  unknown_date_count: 0,
  metrics: [],
  modules: [],
  durations: [],
  limitations: ["Only saved facts"],
  digest: "0".repeat(64),
};
test("aggregate report separates dates, duration sources, evidence counts and missing samples", () => {
  const result = summarizeAccountFacts({
    start: "2026-11-08",
    end: "2026-11-14",
    timezone: "UTC",
    snapshot_at: clock().toISOString(),
    facts: [
      { kind: "task_completed", date: "2026-11-09" },
      { kind: "task_completed", date: "2026-11-20" },
      { kind: "lesson", date: "2026-11-11" },
      { kind: "learning_notes", date: null },
    ],
    forms: {
      modules: [{ id: "m", name: "Module" }],
      checkins: { "2026-11-09": { m: 1 }, "2026-11-10": { m: 0 } },
      habits: { "2026-11-09": { minutes: 30 }, "2026-11-10": { minutes: 0 } },
      predictions: [],
      decisions: [],
      reviews: [],
      insights: [],
      todos: [],
      customRecords: [],
    },
    action_minutes: 20,
    goal_minutes: 10,
  } as any);
  assert.equal(
    result.metrics.find((m) => m.key === "task_completed")?.count,
    1,
  );
  assert.equal(result.active_days, 1);
  assert.equal(result.modules[0].recorded_days, 1);
  assert.equal(
    result.durations.find((d) => d.key === "manual_habits")?.minutes,
    30,
  );
  assert.equal(result.durations.find((d) => d.key === "actions")?.minutes, 20);
  assert.equal(result.unknown_date_count, 1);
  assert.equal("total_minutes" in result, false);
});
test("report receipts survive failures and deletion; retries reuse frozen facts without recapturing", async () => {
  const repo = new InMemoryLightTickRepository();
  let captures = 0,
    calls = 0;
  const service = new AccountReportService(
    repo,
    { add: async () => ({}) } as any,
    async () => {},
    clock,
    async () => {
      captures++;
      return structuredClone(frozen);
    },
  );
  const facts = await service.create(owner, {
    request_key: "facts-request-01",
    period_days: 7,
    mode: "facts",
  });
  assert.equal(facts.status, "ready");
  assert.equal(captures, 1);
  assert.equal(
    (
      await service.create(owner, {
        request_key: "facts-request-01",
        period_days: 7,
        mode: "facts",
      })
    ).id,
    facts.id,
  );
  assert.equal(captures, 1);
  await assert.rejects(
    () =>
      service.create(owner, {
        request_key: "facts-request-01",
        period_days: 30,
        mode: "facts",
      }),
    { statusCode: 409 },
  );
  const work = await service.create(owner, {
    request_key: "ai-request-0001",
    period_days: 7,
    mode: "ai",
  });
  const runner = new AccountReportRunner(service, {
    complete: async () => {
      calls++;
      throw Error("upstream credentials");
    },
  } as any);
  await runner.execute(owner, work.id);
  const failed = await service.get(owner, work.id);
  assert.equal(failed.status, "failed");
  assert.equal(JSON.stringify(failed).includes("credentials"), false);
  const retry = await service.create(owner, {
    request_key: "ai-request-0002",
    period_days: 7,
    mode: "ai",
    retry_of: work.id,
  });
  assert.deepEqual(retry.facts, failed.facts);
  assert.equal(captures, 2);
  await service.mutate(owner, retry.id, "cancel", { base_version: 1 });
  await runner.execute(owner, retry.id);
  assert.equal(calls, 1);
  await service.mutate(owner, facts.id, "delete", { base_version: 1 });
  assert.equal(
    (await service.byRequest(owner, "facts-request-01")).status,
    "deleted",
  );
  assert.equal((await service.get(owner, facts.id)).facts, null);
  assert.equal((await service.list(owner, {})).total, 2);
  assert.equal(
    (await service.list({ ...owner, userId: "user_bob" }, {})).total,
    0,
  );
});

test("concurrent workers call once; cancellation fences late output; expired leases never silently re-call AI", async () => {
  const repo = new InMemoryLightTickRepository();
  let calls = 0,
    resolve!: (v: any) => void;
  const service = new AccountReportService(
    repo,
    { add: async () => ({}) } as any,
    async () => {},
    clock,
    async () => structuredClone(frozen),
  );
  const work = await service.create(owner, {
    request_key: "late-report-001",
    period_days: 7,
    mode: "ai",
  });
  const runner = new AccountReportRunner(service, {
    complete: async () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
  } as any);
  const executing = runner.execute(owner, work.id);
  for (let i = 0; i < 30 && !resolve; i++)
    await new Promise((r) => setTimeout(r, 1));
  await runner.execute(owner, work.id);
  assert.equal(calls, 1);
  const running = await service.get(owner, work.id);
  await service.mutate(owner, work.id, "cancel", {
    base_version: running.revision,
  });
  resolve({
    text: JSON.stringify({
      overview: "Late output",
      observations: [],
      suggestions: [],
      limitations: "No data",
    }),
    finishReason: "stop",
    provider: "synthetic",
    providerModel: "synthetic",
  });
  await executing;
  assert.equal((await service.get(owner, work.id)).status, "cancelled");
  assert.equal((await service.get(owner, work.id)).output, null);
  const crashed = await service.create(owner, {
      request_key: "crashed-report-001",
      period_days: 7,
      mode: "ai",
    }),
    row = (await repo.accountReports.get(owner, crashed.id))!;
  await repo.accountReports.save(
    {
      ...row,
      status: "running",
      revision: 2,
      fence: "crashed",
      lease_until: "2026-11-13T00:00:00Z",
    },
    1,
  );
  await runner.recover();
  assert.equal((await service.get(owner, row.id)).status, "interrupted");
  assert.equal(calls, 1);
});

test("AI report output rejects invented evidence keys, links and malformed observations", () => {
  const good = {
    overview: "Saved facts only",
    observations: [{ text: "One record", evidence_keys: ["record"] }],
    suggestions: ["Try one experiment"],
    limitations: "One window",
  };
  assert.equal(
    validateAccountReportOutput(good, ["record"]).observations.length,
    1,
  );
  assert.throws(() =>
    validateAccountReportOutput(
      {
        ...good,
        observations: [{ text: "Invented", evidence_keys: ["secret_unknown"] }],
      },
      ["record"],
    ),
  );
  assert.throws(() =>
    validateAccountReportOutput(
      { ...good, overview: "https://invented.example/report" },
      ["record"],
    ),
  );
});
