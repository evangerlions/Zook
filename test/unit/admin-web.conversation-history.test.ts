import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellPath = new URL("../../apps/admin-web/app/components/app-shell.tsx", import.meta.url);
const routesPath = new URL("../../apps/admin-web/app/routes.ts", import.meta.url);
const historyRoutePath = new URL("../../apps/admin-web/app/routes/conversation-history.tsx", import.meta.url);

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
