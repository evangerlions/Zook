import assert from "node:assert/strict";
import test from "node:test";

import { createApplication } from "../support/create-test-application.ts";

function adminAuthorization() {
  return `Basic ${Buffer.from("admin:AdminPass123!").toString("base64")}`;
}

test("admin AINovel conversation records query accepts UID and DID pages", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  await runtime.database.aiNovelConversationStore.insert({
    id: "conversation_a",
    appId: "ai_novel",
    userId: "user_a",
    did: "did_a",
    requestId: "request_a",
    sceneKey: "chapter_draft",
    userText: "用户正文",
    assistantText: "AI 正文",
    createdAt: "2026-09-07T00:00:00.000Z",
  });

  const uidResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/conversation-records",
    headers: { authorization: adminAuthorization() },
    query: { uid: "user_a" },
  });
  assert.equal(uidResponse.statusCode, 200);
  assert.equal(uidResponse.body.data.items.length, 1);
  assert.equal(uidResponse.body.data.items[0]?.userText, "用户正文");
  assert.equal(uidResponse.body.data.items[0]?.assistantText, "AI 正文");

  const didResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/conversation-records",
    headers: { authorization: adminAuthorization() },
    query: { did: "did_a", page: "0" },
  });
  assert.equal(didResponse.statusCode, 200);
  assert.equal(didResponse.body.data.query.did, "did_a");
  assert.equal(didResponse.body.data.items[0]?.requestId, "request_a");

  const defaultResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/conversation-records",
    headers: { authorization: adminAuthorization() },
  });
  assert.equal(defaultResponse.statusCode, 200);
  assert.deepEqual(defaultResponse.body.data.query, {});
  assert.equal(defaultResponse.body.data.items[0]?.requestId, "request_a");
});

test("admin AINovel conversation records query rejects ambiguous identifiers", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/conversation-records",
    headers: { authorization: adminAuthorization() },
    query: { uid: "user_a", did: "did_a" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_QUERY");
});
