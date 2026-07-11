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

  const snapshot = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/statistics/snapshot",
    headers: { authorization },
    body: {
      totalWorks: 3,
      totalWords: 12000,
      totalChapters: 8,
      activeWritingDays: 4,
      daily: [
        { date: "2026-07-01", words: 700, active: true },
        { date: "2026-07-02", words: 1200, active: true },
      ],
    },
  });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.body.data.accepted, true);

  await runtime.services.aiNovelStatisticsService.recordTokenUsage({
    appId: "ai_novel",
    userId: session.userId,
    totalTokens: 450,
    occurredAt: new Date("2026-07-02T10:00:00+08:00"),
  });

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/statistics",
    headers: { authorization },
  });

  assert.equal(response.statusCode, 200);
  const data = response.body.data;
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
      { date: "2026-07-01", words: 700, tokens: 0 },
      { date: "2026-07-02", words: 1200, tokens: 450 },
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
