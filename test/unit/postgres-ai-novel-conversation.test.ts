import assert from "node:assert/strict";
import test from "node:test";

import { PostgresAiNovelConversationStore } from "../../src/infrastructure/database/postgres/postgres-ai-novel-conversation.ts";

test("Postgres conversation records persist optional message ids without changing legacy rows", async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const store = new PostgresAiNovelConversationStore(async (sql, values = []) => {
    queries.push({ sql, values });
    if (sql.startsWith("INSERT")) return { rowCount: 1, rows: [] } as never;
    return {
      rowCount: 2,
      rows: [
        {
          id: "record_new",
          user_id: "user_a",
          did: "did_a",
          request_id: "request_new",
          message_id: "message_a",
          session_id: "session_a",
          turn_id: "turn_a",
          scene_key: "write_turn",
          user_text: "继续",
          assistant_text: "好的",
          created_at: "2026-09-11T00:00:00.000Z",
        },
        {
          id: "record_old",
          user_id: "user_a",
          did: null,
          request_id: "request_old",
          message_id: null,
          session_id: null,
          turn_id: null,
          scene_key: "kickoff_turn",
          user_text: "开始",
          assistant_text: "好的",
          created_at: "2026-09-10T00:00:00.000Z",
        },
      ],
    } as never;
  });

  const inserted = await store.insert({
    id: "record_new",
    appId: "ai_novel",
    userId: "user_a",
    requestId: "request_new",
    messageId: "message_a",
    sessionId: "session_a",
    turnId: "turn_a",
    sceneKey: "write_turn",
    userText: "继续",
    assistantText: "好的",
    createdAt: "2026-09-11T00:00:00.000Z",
  });
  assert.equal(inserted, true);
  assert.deepEqual(queries[0]?.values, [
    "record_new",
    "ai_novel",
    "user_a",
    null,
    "request_new",
    "write_turn",
    "message_a",
    "session_a",
    "turn_a",
    "继续",
    "好的",
    "2026-09-11T00:00:00.000Z",
  ]);

  const records = await store.list({ appId: "ai_novel" });
  assert.equal(records[0]?.messageId, "message_a");
  assert.equal(records[0]?.sessionId, "session_a");
  assert.equal(records[0]?.turnId, "turn_a");
  assert.equal(records[1]?.messageId, undefined);
  assert.equal(records[1]?.sessionId, undefined);
  assert.equal(records[1]?.turnId, undefined);
});
