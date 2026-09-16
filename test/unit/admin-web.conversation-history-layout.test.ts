import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const historyRoutePath = new URL("../../apps/admin-web/app/routes/conversation-history.tsx", import.meta.url);
const historyStylesPath = new URL("../../apps/admin-web/app/styles/conversation-history.css", import.meta.url);
const sceneTagPath = new URL("../../apps/admin-web/app/lib/scene-tag.ts", import.meta.url);

test("admin web history uses a dense two-line table with a detail drawer", async () => {
  const [route, styles, sceneTag] = await Promise.all([
    readFile(historyRoutePath, "utf8"),
    readFile(historyStylesPath, "utf8"),
    readFile(sceneTagPath, "utf8"),
  ]);

  const sceneIndex = route.indexOf('title: "场景"');
  const userMessageIndex = route.indexOf('title: "用户消息"');
  const assistantMessageIndex = route.indexOf('title: "AI 回复"');
  assert.ok(sceneIndex >= 0 && sceneIndex < userMessageIndex);
  assert.ok(userMessageIndex < assistantMessageIndex);
  assert.match(route, /<Table<AdminAiNovelConversationRecord>/);
  assert.match(route, /<Drawer/);
  assert.match(sceneTag, /kickoff_turn: "blue"/);
  assert.match(sceneTag, /kickoff_turn_imported_book: "purple"/);
  assert.match(sceneTag, /write_turn: "green"/);
  assert.match(sceneTag, /history_chapter_qa: "orange"/);
  assert.match(route, /color={sceneTagColor\(value\)}/);
  assert.match(styles, /-webkit-line-clamp: 2/);
  assert.match(styles, /\.conversation-history-message-preview/);
});
