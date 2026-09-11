import assert from "node:assert/strict";
import test from "node:test";

import { AiNovelConversationRecordService } from "../../src/modules/ai-novel/ai-novel-conversation-record.service.ts";
import { extractAiNovelConversationRecordIds } from "../../src/modules/ai-novel/ai-novel-conversation-record-ids.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

test("conversation record ids are optional and malformed legacy values are ignored", () => {
  assert.deepEqual(
    extractAiNovelConversationRecordIds({
      messages: [{ role: "user", content: "旧客户端" }],
    }),
    {},
  );
  assert.deepEqual(
    extractAiNovelConversationRecordIds({
      context: { messageId: 123, sessionId: " session_a ", turn_id: "turn_a" },
      messages: [{ role: "user", content: "新客户端", id: "message_a" }],
    }),
    {
      messageId: "message_a",
      sessionId: "session_a",
      turnId: "turn_a",
    },
  );
});

test("AINovel conversation records trim from 121 turns to the latest 100 turns", async () => {
  const database = new InMemoryDatabase();
  let currentTime = new Date("2026-09-07T00:00:00.000Z");
  const service = new AiNovelConversationRecordService(
    database,
    () => currentTime,
  );

  for (let index = 0; index < 121; index += 1) {
    currentTime = new Date(Date.parse("2026-09-07T00:00:00.000Z") + index * 1000);
    await service.recordCompletedTurn({
      userId: "user_a",
      did: "did_a",
      requestId: `request_${index}`,
      sceneKey: "write_turn",
      userText: `用户 ${index}`,
      assistantText: `AI ${index}`,
    });
  }

  const document = await service.listForAdmin({ uid: "user_a" });
  assert.equal(document.items.length, 100);
  assert.equal(document.items[0]?.requestId, "request_120");
  assert.equal(document.items.at(-1)?.requestId, "request_21");
  assert.equal(document.hasMore, false);
});

test("AINovel conversation records support DID lookup and page through older ranges", async () => {
  const database = new InMemoryDatabase();
  let currentTime = new Date("2026-09-07T00:00:00.000Z");
  const service = new AiNovelConversationRecordService(
    database,
    () => currentTime,
  );

  for (let index = 0; index < 102; index += 1) {
    currentTime = new Date(Date.parse("2026-09-07T00:00:00.000Z") + index * 1000);
    await service.recordCompletedTurn({
      userId: `user_${index}`,
      did: "shared_did",
      requestId: "request_1",
      sceneKey: "write_turn",
      userText: `用户 ${index}`,
      assistantText: `AI ${index}`,
    });
  }

  const latest = await service.listForAdmin({ did: "shared_did" });
  assert.equal(latest.items.length, 100);
  assert.equal(latest.hasMore, true);
  assert.equal(latest.items[0]?.userId, "user_101");

  const older = await service.listForAdmin({ did: "shared_did", page: 1 });
  assert.equal(older.items.length, 2);
  assert.equal(older.hasMore, false);
  assert.equal(older.items[0]?.userId, "user_1");
});

test("AINovel conversation record lookup defaults to every user and pages older records", async () => {
  const database = new InMemoryDatabase();
  let currentTime = new Date("2026-09-07T00:00:00.000Z");
  const service = new AiNovelConversationRecordService(database, () => currentTime);
  for (let index = 0; index < 102; index += 1) {
    currentTime = new Date(Date.parse("2026-09-07T00:00:00.000Z") + index * 1000);
    await service.recordCompletedTurn({
      userId: `user_${index % 2}`,
      requestId: `request_${index}`,
      sceneKey: "write_turn",
      userText: `用户 ${index}`,
      assistantText: `AI ${index}`,
    });
  }

  const latest = await service.listForAdmin({});
  assert.deepEqual(latest.query, {});
  assert.equal(latest.items.length, 100);
  assert.equal(latest.items[0]?.requestId, "request_101");
  assert.equal(latest.hasMore, true);

  const older = await service.listForAdmin({ page: 1 });
  assert.equal(older.items.length, 2);
  assert.equal(older.items[0]?.requestId, "request_1");
  assert.equal(older.hasMore, false);
});

test("AINovel conversation record lookup rejects ambiguous identifiers", async () => {
  const service = new AiNovelConversationRecordService(new InMemoryDatabase());
  await assert.rejects(
    () => service.listForAdmin({ uid: "user_a", did: "did_a" }),
    /at most one of uid or did/,
  );
});

test("AINovel conversation records are removed with the user's app runtime data", async () => {
  const database = new InMemoryDatabase();
  const service = new AiNovelConversationRecordService(database);
  await service.recordCompletedTurn({
    userId: "user_delete",
    requestId: "request_delete",
    sceneKey: "write_turn",
    userText: "待删除用户正文",
    assistantText: "待删除 AI 正文",
  });

  database.deleteAppUserRuntimeData("ai_novel", "user_delete");

  const document = await service.listForAdmin({ uid: "user_delete" });
  assert.equal(document.items.length, 0);
});
