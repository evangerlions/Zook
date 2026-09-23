import assert from "node:assert/strict";
import test from "node:test";

import { resolveAiNovelChatScene } from "../../src/modules/ai-novel/ai-novel-llm-scenes.ts";

test("long-running AI Novel scenes keep enough completion budget for thinking and output", () => {
  assert.equal(resolveAiNovelChatScene("kickoff_turn").defaultMaxTokens, 32_768);
  assert.equal(
    resolveAiNovelChatScene("kickoff_turn_imported_book").defaultMaxTokens,
    32_768,
  );
  assert.equal(resolveAiNovelChatScene("chat_compaction").defaultMaxTokens, 16_384);
  assert.equal(resolveAiNovelChatScene("write_turn").defaultMaxTokens, 65_536);
  assert.equal(
    resolveAiNovelChatScene("history_chapter_qa").defaultMaxTokens,
    32_768,
  );
  assert.equal(resolveAiNovelChatScene("chapter_draft").defaultMaxTokens, 65_536);
  assert.equal(
    resolveAiNovelChatScene("import_book_agent").defaultMaxTokens,
    32_768,
  );
  for (const sceneKey of [
    "chapter_summary",
    "chapter_draft_review",
    "snapshot_generation",
    "next_chapter_brief",
  ]) {
    assert.equal(resolveAiNovelChatScene(sceneKey).defaultMaxTokens, 16_384);
  }
});
