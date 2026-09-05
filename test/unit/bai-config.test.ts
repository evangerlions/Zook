import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeLlmProviderKeys } from "../../src/application-llm-provider-keys.ts";
import {
  BAI_API_KEY_PASSWORD_KEY,
  BAI_API_KEY_REFERENCE,
  BAI_GLM_5_3_FLASH_MODEL_KEY,
  addBaiConfig,
} from "../../src/services/bai-config.ts";
import {
  BAI_GLM_5_3_FLASH_MODEL,
  BAI_PROVIDER_KEY,
  DEFAULT_BAI_BASE_URL,
} from "../../src/services/bai-openai-compatible-provider.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { createApplication } from "../support/create-test-application.ts";

test("factory imports B.AI from PASSWORDS and resolves its API key at runtime", async () => {
  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  const passwordConfigService = new CommonPasswordConfigService(
    new PasswordManager(kvManager),
  );
  await passwordConfigService.set(
    BAI_API_KEY_PASSWORD_KEY,
    "B.AI API Key",
    "resolved-bai-api-key",
  );

  const runtime = await createApplication({ kvManager });
  try {
    const document = await runtime.services.commonLlmConfigService.getDocument();
    const provider = document.config.providers.find(
      (item) => item.key === BAI_PROVIDER_KEY,
    );
    const model = document.config.models.find(
      (item) => item.key === BAI_GLM_5_3_FLASH_MODEL_KEY,
    );

    assert.deepEqual(provider, {
      key: BAI_PROVIDER_KEY,
      label: "B.AI",
      enabled: true,
      baseUrl: DEFAULT_BAI_BASE_URL,
      apiKey: BAI_API_KEY_REFERENCE,
      timeoutMs: 60_000,
    });
    assert.deepEqual(model?.routes, [{
      provider: BAI_PROVIDER_KEY,
      providerModel: BAI_GLM_5_3_FLASH_MODEL,
      enabled: true,
      weight: 100,
    }]);
    assert.notEqual(document.config.defaultModelKey, BAI_GLM_5_3_FLASH_MODEL_KEY);

    const runtimeConfig = await runtime.services.commonLlmConfigService.getRuntimeConfig();
    assert.equal(
      runtimeConfig?.providers.find((item) => item.key === BAI_PROVIDER_KEY)?.apiKey,
      "resolved-bai-api-key",
    );
    assert.equal(document.revisions[0]?.desc, "import B.AI from PASSWORDS");
    assert.equal(addBaiConfig(document.config), undefined);
  } finally {
    await runtime.close();
  }
});

test("factory skips B.AI import when the PASSWORDS key is absent", async () => {
  const runtime = await createApplication();
  try {
    const config = await runtime.services.commonLlmConfigService.getCurrentConfig();
    assert.equal(config.providers.some((item) => item.key === BAI_PROVIDER_KEY), false);
    assert.equal(config.models.some((item) => item.key === BAI_GLM_5_3_FLASH_MODEL_KEY), false);
  } finally {
    await runtime.close();
  }
});

test("B.AI is available for chat but not embeddings", () => {
  const providerKeys = resolveRuntimeLlmProviderKeys({});

  assert.equal(providerKeys.chat.has(BAI_PROVIDER_KEY), true);
  assert.equal(providerKeys.embedding.has(BAI_PROVIDER_KEY), false);
});
