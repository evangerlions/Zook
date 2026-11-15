import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { AccountReportService } from "../../src/modules/lighttick/account-reports/account-report.service.ts";
import { BehaviorService } from "../../src/modules/lighttick/behavior/behavior.service.ts";
const o = { appId: "lighttick" as const, userId: "user_alice" },
  clock = () => new Date("2026-11-15T08:00:00Z");
test("behavior report freezes only aggregates and topics cannot cross-read, retry or delete each other", async () => {
  const repo = Object.assign(new InMemoryLightTickRepository(), {
      listReadingArticles: async () => [],
      listReadingStates: async () => [],
      listReadingFeedback: async () => [],
    }),
    behavior = new BehaviorService(repo, clock);
  await behavior.save(
    o,
    "application-report",
    {
      base_version: 0,
      date: "2026-11-15",
      module_id: "general",
      concept: "检验假设",
      scenario: "PRIVATE_SCENARIO_MUST_NOT_SEND",
      effectiveness: 4,
    },
    "behavior-report-source",
  );
  const reports = new AccountReportService(
      repo,
      undefined,
      undefined,
      clock,
      undefined,
      "behavior",
    ),
    account = new AccountReportService(repo, undefined, undefined, clock);
  const r = await reports.create(o, {
    request_key: "behavior-report-create",
    period_days: 7,
    mode: "facts",
  });
  assert.equal(r.topic, "behavior");
  assert.equal(r.facts!.behavior!.applications.total, 1);
  assert.equal(r.facts!.behavior!.applications.effectiveness_avg, 4);
  assert.ok(!JSON.stringify(r.facts).includes("PRIVATE_SCENARIO"));
  assert.equal((await account.list(o, {})).total, 0);
  await assert.rejects(account.get(o, r.id), { statusCode: 404 });
  await assert.rejects(account.mutate(o, r.id, "delete", { base_version: 1 }), {
    statusCode: 404,
  });
  await behavior.archive(
    o,
    "application-report",
    { base_version: 1, archived: true },
    "behavior-report-archive",
  );
  assert.equal(
    (await reports.get(o, r.id)).facts!.behavior!.applications.total,
    1,
  );
  assert.equal((await reports.list(o, {})).total, 1);
});
import { AccountReportRunner } from "../../src/modules/lighttick/account-reports/account-report.runner.ts";
test("behavior AI uses the existing runner, frozen aggregate evidence, failure retry and cancellation fences", async () => {
  const repo = Object.assign(new InMemoryLightTickRepository(), {
      listReadingArticles: async () => [],
      listReadingStates: async () => [],
      listReadingFeedback: async () => [],
    }),
    behavior = new BehaviorService(repo, clock);
  await behavior.save(
    o,
    "application-ai",
    {
      base_version: 0,
      date: "2026-11-15",
      module_id: "general",
      concept: "复核",
      scenario: "PRIVATE_SCENARIO_MUST_NOT_SEND",
      effectiveness: 3,
    },
    "behavior-ai-source",
  );
  const reports = new AccountReportService(
    repo,
    { add: async () => ({}) } as any,
    undefined,
    clock,
    undefined,
    "behavior",
  );
  let calls = 0,
    hold = false,
    finish!: () => void;
  const runner = new AccountReportRunner(reports, {
    complete: async (request: any) => {
      calls++;
      assert.ok(!JSON.stringify(request.messages).includes("PRIVATE_SCENARIO"));
      if (calls === 1) throw Error("PRIVATE_PROVIDER_SECRET");
      if (hold)
        await new Promise<void>((r) => {
          finish = r;
        });
      return {
        text: JSON.stringify({
          overview: "仅本期已保存事实",
          observations: [
            { text: "应用记录1条", evidence_keys: ["behavior_applications"] },
          ],
          suggestions: ["补充一项结果验证"],
          limitations: "自评不证明实际效果",
        }),
        finishReason: "stop",
        provider: "synthetic",
        providerModel: "behavior-test",
      };
    },
  } as any);
  const first = await reports.create(o, {
    request_key: "behavior-ai-first",
    mode: "ai",
    period_days: 7,
  });
  await runner.execute(o, first.id);
  assert.equal((await reports.get(o, first.id)).status, "failed");
  assert.ok(
    !JSON.stringify(await reports.get(o, first.id)).includes(
      "PRIVATE_PROVIDER_SECRET",
    ),
  );
  await behavior.archive(
    o,
    "application-ai",
    { base_version: 1, archived: true },
    "behavior-ai-archive",
  );
  const retry = await reports.create(o, {
    request_key: "behavior-ai-retry",
    mode: "ai",
    period_days: 7,
    retry_of: first.id,
  });
  assert.deepEqual(retry.facts, first.facts);
  await runner.execute(o, retry.id);
  assert.equal(
    (await reports.get(o, retry.id)).output!.prompt_version,
    "behavior-report-v1",
  );
  hold = true;
  const work = await reports.create(o, {
    request_key: "behavior-ai-cancel",
    mode: "ai",
    period_days: 7,
  });
  const running = runner.execute(o, work.id);
  for (let i = 0; i < 50 && !finish; i++)
    await new Promise((r) => setTimeout(r, 1));
  await reports.mutate(o, work.id, "cancel", {
    base_version: (await reports.get(o, work.id)).revision,
  });
  finish();
  await running;
  assert.equal((await reports.get(o, work.id)).status, "cancelled");
  assert.equal((await reports.get(o, work.id)).output, null);
  assert.equal((await new AccountReportService(repo).list(o, {})).total, 0);
});
test("behavior topic does not depend on unrelated investment research availability", async () => {
  const repo = Object.assign(new InMemoryLightTickRepository(), {
    listReadingArticles: async () => [],
    listReadingStates: async () => [],
    listReadingFeedback: async () => [],
  });
  repo.investments.research.list = async () => {
    throw Error("UNRELATED_INVESTMENT_UNAVAILABLE");
  };
  const reports = new AccountReportService(
    repo,
    undefined,
    undefined,
    clock,
    undefined,
    "behavior",
  );
  const r = await reports.create(o, {
    request_key: "behavior-no-investments",
    period_days: 7,
    mode: "facts",
  });
  assert.equal(r.facts!.behavior!.applications.total, 0);
  assert.ok(!r.facts!.metrics.some((m) => m.key.startsWith("investment_")));
});
