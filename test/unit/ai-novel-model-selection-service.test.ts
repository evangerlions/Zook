import assert from "node:assert/strict";
import test from "node:test";
import { AiNovelLlmService } from "../../src/modules/ai-novel/ai-novel-llm.service.ts";

test("nonstream requests forward manual preference; absent preference stays Auto", async () => {
  const selections: unknown[] = [];
  const models: string[] = [];
  const service = new AiNovelLlmService(
    { complete: async (request: { modelKey: string }) => {
      models.push(request.modelKey);
      return { content: "summary", finishReason: "stop" };
    } } as never,
    {} as never,
    { resolveChatModelKey: async (_identity: unknown, options: { selection: { mode: string; modelKey?: string } }) => {
      selections.push(options.selection);
      return options.selection.modelKey ?? "automatic";
    } } as never,
  );
  const body = { sceneKey: "chat_compaction", messages: [{ role: "user", content: "summarize" }] };
  await service.createChatCompletion({ ...body, modelSelection: { mode: "manual", modelKey: "manual" } });
  await service.createChatCompletion(body);
  assert.deepEqual(selections, [{ mode: "manual", modelKey: "manual" }, { mode: "auto" }]);
  assert.deepEqual(models, ["manual", "automatic"]);
});

test("embedding rejects a chat preference before invoking upstream", async () => {
  let calls = 0;
  const service = new AiNovelLlmService({} as never, { embed: async () => { calls++; } } as never, {} as never);
  await assert.rejects(service.createEmbeddings({ sceneKey: "memory_embedding", input: ["memory"], modelSelection: { mode: "auto" } }), /only allowed for chat/);
  assert.equal(calls, 0);
});
