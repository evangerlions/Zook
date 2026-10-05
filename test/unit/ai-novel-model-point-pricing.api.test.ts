import assert from "node:assert/strict";
import test from "node:test";

import { createApplication } from "../support/create-test-application.ts";

const PATH = "/api/v1/admin/apps/ai_novel/model-point-pricing";

function createRuntime() {
  return createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
  });
}

function request(
  runtime: Awaited<ReturnType<typeof createApplication>>,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: Record<string, unknown>,
) {
  return runtime.app.handle({
    method,
    path,
    headers: {
      authorization: `Basic ${Buffer.from("admin:AdminPass123!").toString("base64")}`,
    },
    ...(body ? { body } : {}),
  });
}

test("AINovel point pricing has OpenRouter-based defaults for current models", async () => {
  const runtime = await createRuntime();
  const response = await request(runtime, "GET", PATH);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.configKey, "ai_novel.model_point_pricing");
  assert.equal(response.body.data.config.models.length, 18);
  assert.equal(response.body.data.revision, undefined);
  assert.equal(response.body.data.availableModels.length >= 18, true);

  const prices = new Map(
    response.body.data.config.models.map((item: { modelKey: string }) => [item.modelKey, item]),
  );
  assert.deepEqual(prices.get("qwen3.8-flash"), {
    modelKey: "qwen3.8-flash",
    cachedInputPointsPerMillionTokens: 10,
    inputPointsPerMillionTokens: 50,
    outputPointsPerMillionTokens: 150,
  });
  assert.ok(prices.has("qwen3.8-max"));

  const doubao = response.body.data.availableModels.find(
    (model: { key: string }) => model.key === "doubao-seed-2.0-pro",
  );
  assert.equal(doubao.reference.match, "unavailable");
  assert.equal(doubao.reference.source, "product");
});

test("AINovel point pricing updates, versions, restores, and only resolves for AINovel", async () => {
  const runtime = await createRuntime();
  const config = {
    schemaVersion: 1,
    models: [{
      modelKey: "qwen3.8-flash",
      inputPointsPerMillionTokens: 1800,
      outputPointsPerMillionTokens: 5000,
    }],
  };
  const saved = await request(runtime, "PUT", PATH, { config, desc: "adjust flash" });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.data.revision, 1);
  assert.deepEqual(saved.body.data.config, config);
  assert.deepEqual(
    await runtime.services.aiNovelModelPointPricingConfigService.resolveModelPointPricing(
      "ai_novel",
      "qwen3.8-flash",
    ),
    { inputPointsPerMillionTokens: 1800, outputPointsPerMillionTokens: 5000 },
  );
  assert.equal(
    await runtime.services.aiNovelModelPointPricingConfigService.resolveModelPointPricing(
      "another_app",
      "qwen3.8-flash",
    ),
    undefined,
  );

  const revision = await request(runtime, "GET", `${PATH}/revisions/1`);
  assert.equal(revision.statusCode, 200);
  assert.deepEqual(revision.body.data.config, config);

  const restored = await request(runtime, "POST", `${PATH}/revisions/1/restore`, {});
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.data.revision, 2);
  assert.deepEqual(restored.body.data.config, config);
});

test("AINovel point pricing rejects partial or negative rates", async () => {
  const runtime = await createRuntime();
  const partial = await request(runtime, "PUT", PATH, {
    config: {
      schemaVersion: 1,
      models: [{ modelKey: "qwen3.8-flash", inputPointsPerMillionTokens: 100 }],
    },
  });
  assert.equal(partial.statusCode, 400);

  const negative = await request(runtime, "PUT", PATH, {
    config: {
      schemaVersion: 1,
      models: [{
        modelKey: "qwen3.8-flash",
        inputPointsPerMillionTokens: -1,
        outputPointsPerMillionTokens: 100,
      }],
    },
  });
  assert.equal(negative.statusCode, 400);
});
