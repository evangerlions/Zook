import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { resolveRuntimeLlmProviderKeys } from "../../src/application-llm-provider-keys.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { withContextUsage } from "../../src/services/llm-context-window.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import {
  addAliyunTokenPlanConfig,
  ALIYUN_TOKEN_PLAN_API_KEY_REFERENCE,
  ALIYUN_TOKEN_PLAN_CHAT_MODELS,
  ALIYUN_TOKEN_PLAN_PASSWORD_KEY,
} from "../../src/services/aliyun-token-plan-config.ts";
import {
  ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
  DEFAULT_ALIYUN_TOKEN_PLAN_BASE_URL,
} from "../../src/services/aliyun-token-plan-provider.ts";
import { createApplication } from "../support/create-test-application.ts";

test("factory imports Aliyun Token Plan from PASSWORDS and resolves it at runtime", async () => {
  const kvManager = await KVManager.create({
    backend: new InMemoryKVBackend(),
  });
  const passwordConfigService = new CommonPasswordConfigService(
    new PasswordManager(kvManager),
  );
  await passwordConfigService.set(
    ALIYUN_TOKEN_PLAN_PASSWORD_KEY,
    "Aliyun Token Plan API Key",
    "resolved-token-plan-key",
  );

  const runtime = await createApplication({ kvManager });
  try {
    const document = await runtime.services.commonLlmConfigService.getDocument();
    const provider = document.config.providers.find(
      (item) => item.key === ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
    );
    const importedModels = document.config.models.filter((model) =>
      model.key.startsWith("tokenplan-"),
    );

    assert.deepEqual(provider, {
      key: ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
      label: "Aliyun Bailian Token Plan",
      enabled: true,
      baseUrl: DEFAULT_ALIYUN_TOKEN_PLAN_BASE_URL,
      apiKey: ALIYUN_TOKEN_PLAN_API_KEY_REFERENCE,
      timeoutMs: 60_000,
    });
    assert.deepEqual(
      importedModels.map((model) => model.key),
      ALIYUN_TOKEN_PLAN_CHAT_MODELS.map((model) => model.key),
    );
    assert.deepEqual(
      importedModels.map((model) => model.routes[0]?.providerModel),
      [
        "qwen3.8-max",
        "qwen3.8-flash",
        "qwen3.7-plus",
        "qwen3.7-max",
        "qwen3.6-flash",
        "deepseek-v4-pro-0813",
        "deepseek-v4-pro",
        "deepseek-v4-flash-0731",
        "glm-5.2",
      ],
    );
    assert.equal(
      importedModels.every((model) =>
        model.kind === "chat" &&
        model.strategy === "fixed" &&
        model.routes.length === 1 &&
        model.routes[0]?.provider === ALIYUN_TOKEN_PLAN_PROVIDER_KEY &&
        model.routes[0]?.enabled === true &&
        model.routes[0]?.weight === 100
      ),
      true,
    );
    assert.notEqual(
      document.config.defaultModelKey,
      ALIYUN_TOKEN_PLAN_CHAT_MODELS[0]?.key,
    );

    const runtimeConfig =
      await runtime.services.commonLlmConfigService.getRuntimeConfig();
    assert.equal(
      runtimeConfig?.providers.find(
        (item) => item.key === ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
      )?.apiKey,
      "resolved-token-plan-key",
    );
    assert.equal(
      document.revisions[0]?.desc,
      "import Aliyun Bailian Token Plan from PASSWORDS",
    );
    assert.equal(addAliyunTokenPlanConfig(document.config), undefined);
  } finally {
    await runtime.close();
  }
});

test("factory skips Aliyun Token Plan import when its PASSWORDS key is absent", async () => {
  const runtime = await createApplication();
  try {
    const config = await runtime.services.commonLlmConfigService.getCurrentConfig();
    assert.equal(
      config.providers.some(
        (item) => item.key === ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
      ),
      false,
    );
    assert.equal(
      config.models.some((item) => item.key.startsWith("tokenplan-")),
      false,
    );
  } finally {
    await runtime.close();
  }
});

test("Aliyun Token Plan is available for chat but not embeddings", () => {
  const providerKeys = resolveRuntimeLlmProviderKeys({});

  assert.equal(
    providerKeys.chat.has(ALIYUN_TOKEN_PLAN_PROVIDER_KEY),
    true,
  );
  assert.equal(
    providerKeys.embedding.has(ALIYUN_TOKEN_PLAN_PROVIDER_KEY),
    false,
  );
});

test("Aliyun Token Plan chat models report their one-million-token context window", () => {
  for (const model of ALIYUN_TOKEN_PLAN_CHAT_MODELS) {
    const usage = withContextUsage(
      {
        promptTokens: 250_000,
        completionTokens: 1_000,
        totalTokens: 251_000,
      },
      {
        provider: ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
        modelKey: model.key,
        resolvedModelKey: model.key,
        providerModel: model.providerModel,
      },
    );

    assert.equal(usage?.contextWindowTokens, 1_000_000, model.providerModel);
    assert.equal(usage?.contextUsedRatio, 0.25, model.providerModel);
  }
});
