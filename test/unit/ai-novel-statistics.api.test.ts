import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

async function loginAiNovel(runtime: Awaited<ReturnType<typeof createApplication>>) {
  return await runtime.services.authService.login({
    appId: "ai_novel",
    account: "alice@example.com",
    password: "Password1234",
  });
}

test("AI Novel statistics requires auth", async () => {
  const runtime = await createApplication();

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/statistics",
    headers: {},
  });

  assert.equal(response.statusCode, 401);
});

test("AI Novel statistics snapshot feeds backend report metrics", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);
  const authorization = `Bearer ${session.accessToken}`;
  const today = "2026-07-02";
  const yesterday = "2026-07-01";
  const now = new Date("2026-07-02T10:00:00+08:00");

  const snapshot = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/statistics/snapshot",
    headers: { authorization },
    body: {
      accountId: session.userId,
      totalWorks: 3,
      totalWords: 12000,
      totalChapters: 8,
      activeWritingDays: 4,
      daily: [
        { date: yesterday, words: 700, active: true },
        { date: today, words: 1200, active: true },
      ],
    },
  });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.body.data.accepted, true);

  await runtime.services.aiNovelStatisticsService.recordTokenUsage({
    appId: "ai_novel",
    userId: session.userId,
    totalTokens: 450,
    occurredAt: now,
  });

  const data = await runtime.services.aiNovelStatisticsService.getStatistics(
    { appId: "ai_novel", userId: session.userId },
    now,
  );
  assert.equal(data.overview.totalWorks, 3);
  assert.equal(data.overview.totalWords, 12000);
  assert.equal(data.overview.totalChapters, 8);
  assert.equal(data.overview.activeWritingDays, 4);
  assert.equal(data.summaryCard.totalWords, 12000);
  assert.equal(data.summaryCard.totalTokens, 450);
  assert.equal(data.recentActivity.tokensThisMonth, 450);
  assert.equal(data.writingTrend.days.length, 30);
  assert.deepEqual(
    data.writingTrend.days
      .filter((item: { words: number; tokens: number }) => item.words || item.tokens)
      .map((item: { date: string; words: number; tokens: number }) => ({
        date: item.date,
        words: item.words,
        tokens: item.tokens,
      })),
    [
      { date: yesterday, words: 700, tokens: 0 },
      { date: today, words: 1200, tokens: 450 },
    ],
  );
});

test("AI Novel snapshot replaces writing fields but preserves server token usage", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);
  const auth = { appId: "ai_novel", userId: session.userId };
  const now = new Date("2026-07-02T10:00:00+08:00");

  await runtime.services.aiNovelStatisticsService.recordSnapshot(auth, {
    accountId: session.userId,
    totalWorks: 2,
    totalWords: 100,
    totalChapters: 2,
    activeWritingDays: 2,
    daily: [
      { date: "2026-07-01", words: 40 },
      { date: "2026-07-02", words: 60 },
    ],
  }, now);
  await runtime.services.aiNovelStatisticsService.recordTokenUsage({
    appId: "ai_novel",
    userId: session.userId,
    totalTokens: 25,
    occurredAt: now,
  });
  await runtime.services.aiNovelStatisticsService.recordSnapshot(auth, {
    accountId: session.userId,
    totalWorks: 1,
    totalWords: 50,
    totalChapters: 1,
    activeWritingDays: 1,
    daily: [{ date: "2026-07-01", words: 50 }],
  }, new Date("2026-07-02T11:00:00+08:00"));

  const report = await runtime.services.aiNovelStatisticsService.getStatistics(auth, now);
  assert.equal(report.overview.totalWorks, 1);
  assert.equal(report.overview.activeWritingDays, 1);
  assert.equal(report.summaryCard.totalTokens, 25);
  assert.deepEqual(
    report.writingTrend.days
      .filter((item) => item.date >= "2026-07-01")
      .map((item) => ({ date: item.date, words: item.words, tokens: item.tokens })),
    [
      { date: "2026-07-01", words: 50, tokens: 0 },
      { date: "2026-07-02", words: 0, tokens: 25 },
    ],
  );
});

test("AI Novel statistics rejects invalid snapshot payloads", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/statistics/snapshot",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      accountId: session.userId,
      totalWorks: -1,
      totalWords: 12000,
      totalChapters: 8,
      activeWritingDays: 4,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_BODY");
  assert.equal(runtime.database.aiNovelStatisticsSnapshots.length, 0);
});

test("AI Novel statistics rejects invalid and duplicate daily dates", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const base = {
    accountId: session.userId,
    totalWorks: 1,
    totalWords: 1,
    totalChapters: 1,
    activeWritingDays: 1,
  };

  for (const daily of [
    [{ date: "2026-02-31", words: 1 }],
    [{ date: "2026-07-02", words: 1, active: "yes" }],
    [
      { date: "2026-07-01", words: 1 },
      { date: "2026-07-01", words: 2 },
    ],
  ]) {
    const response = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/ai_novel/statistics/snapshot",
      headers,
      body: { ...base, daily },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "REQ_INVALID_BODY");
  }
});

test("AI Novel statistics rejects a snapshot bound to another account", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/statistics/snapshot",
    headers: { authorization: `Bearer ${session.accessToken}` },
    body: {
      accountId: "user_bob",
      totalWorks: 1,
      totalWords: 1,
      totalChapters: 1,
      activeWritingDays: 1,
      daily: [],
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "AUTH_APP_SCOPE_MISMATCH");
  assert.equal(runtime.database.aiNovelStatisticsSnapshots.length, 0);
});

test("AI Novel statistics cannot be recreated after account membership deletion", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);
  const auth = { appId: "ai_novel", userId: session.userId };
  runtime.database.updateAppUserStatus("ai_novel", session.userId, "DELETED");

  await assert.rejects(
    runtime.services.aiNovelStatisticsService.recordSnapshot(auth, {
      accountId: session.userId,
      totalWorks: 1,
      totalWords: 1,
      totalChapters: 1,
      activeWritingDays: 1,
      daily: [],
    }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 403);
      return true;
    },
  );
  await runtime.services.aiNovelStatisticsService.recordTokenUsage({
    appId: "ai_novel",
    userId: session.userId,
    totalTokens: 10,
  });

  assert.equal(runtime.database.aiNovelStatisticsSnapshots.length, 0);
  assert.equal(runtime.database.aiNovelDailyStatistics.length, 0);
});

test("AI Novel statistics accepts 400 daily items and rejects 401", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const daily = listDailyItems(401);
  const base = {
    accountId: session.userId,
    totalWorks: 1,
    totalWords: 401,
    totalChapters: 1,
    activeWritingDays: 401,
  };

  const accepted = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/statistics/snapshot",
    headers,
    body: { ...base, daily: daily.slice(0, 400) },
  });
  const rejected = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/statistics/snapshot",
    headers,
    body: { ...base, daily },
  });

  assert.equal(accepted.statusCode, 200);
  assert.equal(rejected.statusCode, 400);
});

function listDailyItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    words: 1,
  }));
}
