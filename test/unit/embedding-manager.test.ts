import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { EmbeddingManager, type EmbeddingProvider, type EmbeddingResult, type ResolvedEmbeddingRequest } from "../../src/services/embedding-manager.ts";

test("embedding manager resolves novel-embedding to the Bailian provider model", async () => {
  let capturedRequest: ResolvedEmbeddingRequest | undefined;
  const provider: EmbeddingProvider = {
    async embed(request): Promise<EmbeddingResult> {
      capturedRequest = request;
      return {
        provider: "bailian",
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        vectors: [
          {
            index: 0,
            embedding: [0.1, 0.2, 0.3],
          },
        ],
      };
    },
  };

  const manager = new EmbeddingManager({
    bailian: provider,
  });

  const result = await manager.embed({
    modelKey: "novel-embedding",
    input: ["hello"],
  });

  assert.equal(result.providerModel, "text-embedding-v4");
  assert.equal(capturedRequest?.model.provider, "bailian");
  assert.equal(capturedRequest?.model.providerModel, "text-embedding-v4");
});

test("createApplication exposes embeddingManager and aiNovelLlmService through runtime services", async () => {
  const runtime = await createApplication();

  assert.ok(runtime.services.embeddingManager);
  assert.equal(typeof runtime.services.embeddingManager.embed, "function");
  assert.ok(runtime.services.aiNovelLlmService);
  assert.equal(typeof runtime.services.aiNovelLlmService.createChatCompletion, "function");
  assert.equal(typeof runtime.services.aiNovelLlmService.createEmbeddings, "function");
});

test("embedding manager estimates and records owned usage", async () => {
  const usages: Array<{ userId: string; totalTokens: number }> = [];
  const manager = new EmbeddingManager(
    {
      bailian: {
        async embed(request): Promise<EmbeddingResult> {
          return {
            provider: request.model.provider,
            modelKey: request.model.modelKey,
            providerModel: request.model.providerModel,
            vectors: [{ index: 0, embedding: [0.1] }],
          };
        },
      },
    },
    undefined,
    {
      usageRecorder: ({ userId, usage }) => {
        usages.push({ userId, totalTokens: usage.totalTokens });
      },
    },
  );

  const result = await manager.embed({
    modelKey: "novel-embedding",
    input: ["hello embedding"],
    usageOwner: { appId: "ai_novel", userId: "user_1" },
  });

  assert.equal(result.usage?.estimated, true);
  assert.ok((result.usage?.totalTokens ?? 0) > 0);
  assert.deepEqual(usages, [
    { userId: "user_1", totalTokens: result.usage?.totalTokens ?? 0 },
  ]);
});
