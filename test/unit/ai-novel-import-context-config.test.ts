import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ApplicationError } from "../../src/shared/errors.ts";
import { encryptCreditsFixture, startCreditsHttpRuntime } from "../support/credits-http-runtime.ts";

async function fixture(t: TestContext) {
  const oldTurn = "x".repeat(600_000);
  let retainedOldTurn: boolean | undefined;
  const f = await startCreditsHttpRuntime(0, "test", undefined, {
    provider: {
      async complete() { throw new Error("Expected a streaming upstream call"); },
      async *stream(request) {
        retainedOldTurn = request.messages.some((message) => message.content === oldTurn);
        yield { type: "content_delta", text: "Fixture response" };
        yield { type: "usage", usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } };
        yield { type: "done", finishReason: "stop" };
      },
    },
  });
  t.after(async () => { await f.close(); await f.runtime.close(); });
  const { adminConsoleService: admin, appConfigService } = f.runtime.services;
  await appConfigService.setValue("ai_novel", "ai_novel.import_chapter_segmentation", JSON.stringify({ modelKey: "qwen3.6-plus" }));
  await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig({
    schemaVersion: 1, chat: { default: [{ modelKey: "qwen3.6-plus", weight: 100 }] }, autoFree: { enabled: true },
  });

  return {
    admin,
    appConfigService,
    async sendsOldTurn(sceneKey: string, stream: boolean): Promise<boolean | undefined> {
      retainedOldTurn = undefined;
      const response = await fetch(`${f.url}/api/v1/ai_novel/ai/chat-completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${f.token}`, "X-App-Id": "ai_novel",
          "X-App-Version": "1.8.0", "Content-Type": "application/json",
        },
        body: JSON.stringify(encryptCreditsFixture({
          sceneKey, stream, agentProtocol: "pi-v1", maxTokens: 1000,
          messages: [{ role: "user", content: oldTurn }, { role: "user", content: "Latest request" }],
        })),
      });
      await response.text();
      assert.equal(response.status, 200);
      return retainedOldTurn;
    },
  };
}

test("the saved import budget applies to both import scenes, and restoration reapplies the default", async (t) => {
  const f = await fixture(t);
  const initial = await f.admin.updateConfig("ai_novel", JSON.stringify({ importBook: { coldChunkMaxK: 50 } }));
  assert.equal(await f.sendsOldTurn("import_book_agent", true), false);
  assert.equal(await f.sendsOldTurn("import_chapter_segmentation", false), false);
  assert.equal(await f.sendsOldTurn("chapter_draft", true), true);

  await f.admin.updateConfig("ai_novel", JSON.stringify({ importBook: { coldChunkMaxK: 50, serverContextBudgetTokens: 220_000 } }));
  assert.equal(await f.sendsOldTurn("import_book_agent", true), true);
  assert.equal(await f.sendsOldTurn("import_chapter_segmentation", false), true);

  await f.admin.restoreConfig("ai_novel", initial.revision!);
  assert.equal(await f.sendsOldTurn("import_book_agent", true), false);
});

test("invalid import budgets are rejected on save and historical restore", async (t) => {
  const f = await fixture(t);
  const invalid = JSON.stringify({ importBook: { serverContextBudgetTokens: 0 } });
  const invalidConfig = (error: unknown) =>
    error instanceof ApplicationError && error.code === "ADMIN_CONFIG_INVALID_JSON";
  await assert.rejects(f.admin.updateConfig("ai_novel", invalid), invalidConfig);
  const oldInvalid = await f.appConfigService.setValue("ai_novel", "admin.delivery_config", invalid);
  const valid = await f.admin.updateConfig("ai_novel", JSON.stringify({ importBook: { serverContextBudgetTokens: 220_000 } }));
  await assert.rejects(f.admin.restoreConfig("ai_novel", oldInvalid.revision), invalidConfig);
  assert.equal((await f.admin.getConfig("ai_novel")).revision, valid.revision);
});
