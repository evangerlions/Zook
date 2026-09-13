import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const historyRoutePath = new URL("../../apps/admin-web/app/routes/conversation-history.tsx", import.meta.url);
const historyStylesPath = new URL("../../apps/admin-web/app/styles/conversation-history.css", import.meta.url);

test("admin web history uses a dense two-line table with a detail drawer", async () => {
  const [route, styles] = await Promise.all([
    readFile(historyRoutePath, "utf8"),
    readFile(historyStylesPath, "utf8"),
  ]);

  const sceneIndex = route.indexOf('title: "场景"');
  const userMessageIndex = route.indexOf('title: "用户消息"');
  const assistantMessageIndex = route.indexOf('title: "AI 回复"');
  assert.ok(sceneIndex >= 0 && sceneIndex < userMessageIndex);
  assert.ok(userMessageIndex < assistantMessageIndex);
  assert.match(route, /<Table<AdminAiNovelConversationRecord>/);
  assert.match(route, /<Drawer/);
  assert.match(styles, /-webkit-line-clamp: 2/);
  assert.match(styles, /\.conversation-history-message-preview/);
});
