import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellPath = new URL("../../apps/admin-web/app/components/app-shell.tsx", import.meta.url);
const routesPath = new URL("../../apps/admin-web/app/routes.ts", import.meta.url);
const historyRoutePath = new URL("../../apps/admin-web/app/routes/conversation-history.tsx", import.meta.url);
const traceViewPath = new URL("../../apps/admin-web/app/components/conversation-trace-view.tsx", import.meta.url);
const traceDetailPath = new URL("../../apps/admin-web/app/components/conversation-trace-detail.tsx", import.meta.url);
const traceStylesPath = new URL("../../apps/admin-web/app/styles/conversation-records.css", import.meta.url);
const sceneTagPath = new URL("../../apps/admin-web/app/lib/scene-tag.ts", import.meta.url);

test("admin web keeps historical chat lookup separate from the trace console", async () => {
  const [shell, routes, historyRoute] = await Promise.all([
    readFile(shellPath, "utf8"),
    readFile(routesPath, "utf8"),
    readFile(historyRoutePath, "utf8"),
  ]);

  assert.match(shell, /to: "\/conversation-records", label: "对话追踪", code: "TRC"/);
  assert.match(shell, /to: "\/conversation-history", label: "历史聊天", code: "HST"/);
  assert.match(routes, /route\("conversation-records", "routes\/conversation-records\.tsx"\)/);
  assert.match(routes, /route\("conversation-history", "routes\/conversation-history\.tsx"\)/);
  assert.match(historyRoute, /adminApi\.getAiNovelConversationRecords/);
  assert.doesNotMatch(historyRoute, /getAiNovelDebugTrace/);
});

test("admin trace detail supports change filtering, rendered and highlighted JSON views", async () => {
  const [traceView, traceDetail, traceStyles, sceneTag] = await Promise.all([
    readFile(traceViewPath, "utf8"),
    readFile(traceDetailPath, "utf8"),
    readFile(traceStylesPath, "utf8"),
    readFile(sceneTagPath, "utf8"),
  ]);

  assert.match(traceView, /conversation-trace-detail/);
  assert.match(traceDetail, /type="checkbox"/);
  assert.match(traceDetail, /只显示修改/);
  assert.match(traceDetail, /TraceViewControls/);
  assert.match(traceDetail, /JsonEditor height="min\(186vh, 1800px\)"/);
  assert.match(traceDetail, /changedDiff/);
  assert.match(traceDetail, /conversation-trace-diff-ellipsis/);
  assert.match(traceView, /SceneTag/);
  assert.match(traceDetail, /sceneTagColor/);
  assert.match(sceneTag, /kickoff_turn: "blue"/);
  assert.match(sceneTag, /kickoff_turn_imported_book: "purple"/);
  assert.match(sceneTag, /write_turn: "green"/);
  assert.match(sceneTag, /history_chapter_qa: "orange"/);
  assert.match(sceneTag, /SCENE_TAG_COLORS\[sceneKey\] \?\? "default"/);
  assert.match(traceStyles, /\.conversation-trace-view-controls/);
  assert.match(traceStyles, /min-height: min\(186vh, 1800px\)/);
});
