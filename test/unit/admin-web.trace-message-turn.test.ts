import assert from "node:assert/strict";
import test from "node:test";

import { traceMessageTurnNumbers } from "../../apps/admin-web/app/lib/trace-message-turn.ts";

test("trace message turn labels follow user-message boundaries", () => {
  assert.deepEqual(traceMessageTurnNumbers([
    { role: "system", content: "rules" },
    { role: "user", content: "first" },
    { role: "assistant", content: "first answer" },
    { role: "tool", content: { ok: true } },
    { role: "user", content: "second" },
    { role: "assistant", content: "second answer" },
  ]), [1, 1, 1, 1, 2, 2]);
});

test("trace message turn labels keep pre-user context in the first turn", () => {
  assert.deepEqual(traceMessageTurnNumbers([
    { role: "system", content: "rules" },
    { role: "assistant", content: "setup" },
  ]), [1, 1]);
});

test("trace message turn labels keep global turn numbers after context pruning", () => {
  assert.deepEqual(traceMessageTurnNumbers([
    { role: "assistant", content: "previous answer" },
    { role: "user", content: "seventh" },
    { role: "assistant", content: "seventh answer" },
    { role: "user", content: "eighth" },
  ], 8), [7, 7, 7, 8]);
});
