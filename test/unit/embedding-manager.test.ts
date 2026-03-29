import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
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
