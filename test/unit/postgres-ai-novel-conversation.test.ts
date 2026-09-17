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
          outcome: "success",
          error_code: null,
          error_message: null,
          server_compacted: false,
          prompt_tokens: 12,
          completion_tokens: 34,
          total_tokens: 46,
          reasoning_tokens: 4,
          usage_source: "provider",
          system_prompt: "write system",
          tools_json: [{ name: "read_draft", description: "Read draft", inputSchema: {} }],
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
          outcome: "success",
          error_code: null,
          error_message: null,
          server_compacted: false,
          prompt_tokens: -1,
          completion_tokens: -1,
          total_tokens: -1,
          reasoning_tokens: -1,
          usage_source: "missing",
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
    promptTokens: 12,
    completionTokens: 34,
    totalTokens: 46,
    reasoningTokens: 4,
    usageSource: "provider",
    systemPrompt: "write system",
    tools: [{ name: "read_draft", description: "Read draft", inputSchema: {} }],
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
    "success",
    null,
    null,
    false,
    12,
    34,
    46,
    4,
    "provider",
    "write system",
    JSON.stringify([{ name: "read_draft", description: "Read draft", inputSchema: {} }]),
    "2026-09-11T00:00:00.000Z",
  ]);

  const records = await store.list({ appId: "ai_novel" });
  assert.equal(records[0]?.messageId, "message_a");
  assert.equal(records[0]?.sessionId, "session_a");
  assert.equal(records[0]?.turnId, "turn_a");
  assert.equal(records[0]?.systemPrompt, "write system");
  assert.deepEqual(records[0]?.tools, [{ name: "read_draft", description: "Read draft", inputSchema: {} }]);
  assert.equal(records[0]?.outcome, "success");
  assert.equal(records[0]?.serverCompacted, false);
  assert.equal(records[0]?.promptTokens, 12);
  assert.equal(records[0]?.completionTokens, 34);
  assert.equal(records[0]?.totalTokens, 46);
  assert.equal(records[0]?.reasoningTokens, 4);
  assert.equal(records[0]?.usageSource, "provider");
  assert.equal(records[1]?.messageId, undefined);
  assert.equal(records[1]?.sessionId, undefined);
  assert.equal(records[1]?.turnId, undefined);
  assert.equal(records[1]?.promptTokens, -1);
  assert.equal(records[1]?.completionTokens, -1);
  assert.equal(records[1]?.totalTokens, -1);
  assert.equal(records[1]?.reasoningTokens, -1);
  assert.equal(records[1]?.usageSource, "missing");
});
