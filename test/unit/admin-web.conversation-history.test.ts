import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellPath = new URL("../../apps/admin-web/app/components/app-shell.tsx", import.meta.url);
const routesPath = new URL("../../apps/admin-web/app/routes.ts", import.meta.url);
const historyRoutePath = new URL("../../apps/admin-web/app/routes/conversation-history.tsx", import.meta.url);
const historyDebugPath = new URL("../../apps/admin-web/app/components/conversation-history-debug.tsx", import.meta.url);
const traceViewPath = new URL("../../apps/admin-web/app/components/conversation-trace-view.tsx", import.meta.url);
const traceDetailPath = new URL("../../apps/admin-web/app/components/conversation-trace-detail.tsx", import.meta.url);
const traceContentPath = new URL("../../apps/admin-web/app/components/conversation-trace-content.tsx", import.meta.url);
const debugToolListPath = new URL("../../apps/admin-web/app/components/conversation-debug-tool-list.tsx", import.meta.url);
const traceDebugContextPath = new URL("../../apps/admin-web/app/components/conversation-trace-debug-context.tsx", import.meta.url);
const traceRequestDebugPath = new URL("../../apps/admin-web/app/lib/trace-request-debug.ts", import.meta.url);
const traceMessageTurnPath = new URL("../../apps/admin-web/app/lib/trace-message-turn.ts", import.meta.url);
const contextUsageBadgePath = new URL("../../apps/admin-web/app/components/conversation-context-usage-badge.tsx", import.meta.url);
const traceToolNamePath = new URL("../../apps/admin-web/app/lib/trace-tool-name.ts", import.meta.url);
const traceJsonProjectionPath = new URL("../../apps/admin-web/app/lib/trace-json-projection.ts", import.meta.url);
const traceStylesPath = new URL("../../apps/admin-web/app/styles/conversation-records.css", import.meta.url);
const sceneTagPath = new URL("../../apps/admin-web/app/lib/scene-tag.ts", import.meta.url);

test("admin web keeps historical chat lookup separate from the trace console", async () => {
  const [shell, routes, historyRoute, historyDebug, debugToolList] = await Promise.all([
    readFile(shellPath, "utf8"),
    readFile(routesPath, "utf8"),
    readFile(historyRoutePath, "utf8"),
    readFile(historyDebugPath, "utf8"),
    readFile(debugToolListPath, "utf8"),
  ]);

  assert.match(shell, /to: "\/conversation-records", label: "对话追踪", code: "TRC"/);
  assert.match(shell, /to: "\/conversation-history", label: "历史聊天", code: "HST"/);
  assert.match(routes, /route\("conversation-records", "routes\/conversation-records\.tsx"\)/);
  assert.match(routes, /route\("conversation-history", "routes\/conversation-history\.tsx"\)/);
  assert.match(historyRoute, /adminApi\.getAiNovelConversationRecords/);
  assert.doesNotMatch(historyRoute, /getAiNovelDebugTrace/);
  assert.match(historyRoute, /ConversationHistoryDebugDetails/);
  assert.match(historyDebug, /System prompt/);
  assert.match(historyDebug, /Available tools/);
  assert.match(historyDebug, /ConversationDebugToolList/);
  assert.match(historyDebug, /TraceMarkdownContent/);
  assert.match(historyDebug, /<details className="conversation-history-debug-section">/g);
  assert.match(debugToolList, /<details className="conversation-debug-tool"/);
  assert.match(debugToolList, /TraceMarkdownContent/);
  assert.match(debugToolList, /Input schema/);
  assert.doesNotMatch(debugToolList, /open=/);
});

test("admin trace detail supports change filtering, rendered and highlighted JSON views", async () => {
  const [traceView, traceDetail, traceContent, traceToolName, traceDebugContext, traceRequestDebug, traceMessageTurn, contextUsageBadge, traceStyles, sceneTag, traceJsonProjection] = await Promise.all([
    readFile(traceViewPath, "utf8"),
    readFile(traceDetailPath, "utf8"),
    readFile(traceContentPath, "utf8"),
    readFile(traceToolNamePath, "utf8"),
    readFile(traceDebugContextPath, "utf8"),
    readFile(traceRequestDebugPath, "utf8"),
    readFile(traceMessageTurnPath, "utf8"),
    readFile(contextUsageBadgePath, "utf8"),
    readFile(traceStylesPath, "utf8"),
    readFile(sceneTagPath, "utf8"),
    readFile(traceJsonProjectionPath, "utf8"),
  ]);

  assert.match(traceView, /conversation-trace-detail/);
  assert.match(traceView, /<SceneTag sceneKey=\{session\.kind\} \/>/);
  assert.match(traceDetail, /type="checkbox"/);
  assert.match(traceDetail, /只显示修改/);
  assert.match(traceDetail, /TraceViewControls/);
  assert.match(traceDetail, /JsonEditor height="min\(186vh, 1800px\)"/);
  assert.match(traceDetail, /changedDiff/);
  assert.match(traceDetail, /conversation-trace-diff-ellipsis/);
  assert.match(traceDetail, /conversation-trace-message-ellipsis/);
  assert.match(traceDetail, /conversation-trace-message-sequence/);
  assert.match(traceDetail, /省略 \{omitted\} 条对话/);
  assert.match(traceDetail, /useState\(true\)/);
  assert.match(traceDetail, /全部折叠/);
  assert.match(traceDetail, /conversation-trace-section-action/);
  assert.match(traceDetail, /TraceMessageContent/);
  assert.match(traceDetail, /TraceJsonPreview/);
  assert.match(traceDetail, /<details className="conversation-trace-request">/);
  assert.match(traceDetail, /meta=\{`\$\{requests\.length\} requests`\}/);
  assert.match(traceDetail, /compactTraceRequestForJson/);
  assert.match(traceJsonProjection, /deltaSummary/);
  assert.match(traceJsonProjection, /isStreamDelta/);
  assert.doesNotMatch(traceDetail, /changedRequests/);
  assert.match(traceDetail, /<strong>Req \{index \+ 1\}<\/strong>/);
  assert.match(traceDetail, /conversation-trace-message-turn/);
  assert.match(traceContent, /conversation-trace-markdown-heading/);
  assert.match(traceContent, /conversation-trace-markdown-list-item-content/);
  assert.match(traceContent, /conversation-trace-json-text-value/);
  assert.match(traceContent, /isRenderedTextField/);
  assert.match(traceDetail, /conversation-trace-tool-name/);
  assert.match(traceDetail, /resolveTraceToolName/);
  assert.match(traceToolName, /toolCallId/);
  assert.match(traceToolName, /toolCalls/);
  assert.match(traceDebugContext, /System prompt/);
  assert.match(traceDebugContext, /Available tools/);
  assert.match(traceDebugContext, /ConversationDebugToolList/);
  assert.match(traceDebugContext, /TraceMarkdownContent/);
  assert.match(traceRequestDebug, /collectTraceRequestDebugContext/);
  assert.match(traceRequestDebug, /suppliedTools/);
  assert.match(traceContent, /export function TraceMarkdownContent/);
  assert.match(traceView, /SceneTag/);
  assert.match(traceDetail, /sceneTagColor/);
  assert.match(sceneTag, /kickoff_turn: "blue"/);
  assert.match(sceneTag, /writing: "green"/);
  assert.match(sceneTag, /kickoff_turn_imported_book: "purple"/);
  assert.match(sceneTag, /write_turn: "green"/);
  assert.match(sceneTag, /history_chapter_qa: "orange"/);
  assert.match(sceneTag, /SCENE_TAG_COLORS\[sceneKey\] \?\? "default"/);
  assert.match(traceStyles, /\.conversation-trace-view-controls/);
  assert.match(traceStyles, /min-height: min\(186vh, 1800px\)/);
  assert.match(traceMessageTurn, /traceMessageTurnNumbers/);
  assert.match(traceView, /ConversationContextUsageBadge/);
  assert.match(traceDetail, /ConversationContextUsageBadge/);
  assert.match(contextUsageBadge, /Context remaining/);
  assert.match(contextUsageBadge, /provider fallback/);
});
