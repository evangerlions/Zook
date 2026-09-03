import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { resolveRuntimeLlmProviderKeys } from "../../src/application-llm-provider-keys.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import {
  addVolcengineAgentPlanConfig,
  VOLCENGINE_AGENT_PLAN_API_KEY_REFERENCE,
  VOLCENGINE_AGENT_PLAN_MODEL_KEY,
  VOLCENGINE_AGENT_PLAN_PASSWORD_KEY,
} from "../../src/services/volcengine-agent-plan-config.ts";
import {
  DEFAULT_VOLCENGINE_AGENT_PLAN_BASE_URL,
  VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
} from "../../src/services/volcengine-agent-plan-provider.ts";
import { createApplication } from "../support/create-test-application.ts";

test("factory imports Volcengine Agent Plan from PASSWORDS and resolves it at runtime", async () => {
  const kvManager = await KVManager.create({
    backend: new InMemoryKVBackend(),
  });
  const passwordConfigService = new CommonPasswordConfigService(
    new PasswordManager(kvManager),
  );
  await passwordConfigService.set(
    VOLCENGINE_AGENT_PLAN_PASSWORD_KEY,
    "Volcengine Agent Plan API Key",
    "resolved-volcengine-key",
  );

  const runtime = await createApplication({ kvManager });
  try {
    const document = await runtime.services.commonLlmConfigService.getDocument();
    const provider = document.config.providers.find(
      (item) => item.key === VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
    );
    const model = document.config.models.find(
      (item) => item.key === VOLCENGINE_AGENT_PLAN_MODEL_KEY,
    );

    assert.deepEqual(provider, {
      key: VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
      label: "Volcengine Ark Agent Plan",
      enabled: true,
      baseUrl: DEFAULT_VOLCENGINE_AGENT_PLAN_BASE_URL,
      apiKey: VOLCENGINE_AGENT_PLAN_API_KEY_REFERENCE,
      timeoutMs: 30_000,
    });
    assert.deepEqual(model?.routes, [{
      provider: VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
      providerModel: VOLCENGINE_AGENT_PLAN_MODEL_KEY,
      enabled: true,
      weight: 100,
    }]);
    assert.notEqual(document.config.defaultModelKey, VOLCENGINE_AGENT_PLAN_MODEL_KEY);

    const runtimeConfig =
      await runtime.services.commonLlmConfigService.getRuntimeConfig();
    assert.equal(
      runtimeConfig?.providers.find(
        (item) => item.key === VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
      )?.apiKey,
      "resolved-volcengine-key",
    );
    assert.equal(
      document.revisions[0]?.desc,
      "import Volcengine Ark Agent Plan from PASSWORDS",
    );
    assert.equal(addVolcengineAgentPlanConfig(document.config), undefined);
  } finally {
    await runtime.close();
  }
});

test("factory skips the import when the PASSWORDS key is absent", async () => {
  const runtime = await createApplication();
  try {
    const config = await runtime.services.commonLlmConfigService.getCurrentConfig();
    assert.equal(
      config.providers.some(
        (item) => item.key === VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
      ),
      false,
    );
    assert.equal(
      config.models.some(
        (item) => item.key === VOLCENGINE_AGENT_PLAN_MODEL_KEY,
      ),
      false,
    );
  } finally {
    await runtime.close();
  }
});

test("Volcengine Agent Plan is available for chat but not embeddings", () => {
  const providerKeys = resolveRuntimeLlmProviderKeys({});

  assert.equal(
    providerKeys.chat.has(VOLCENGINE_AGENT_PLAN_PROVIDER_KEY),
    true,
  );
  assert.equal(
    providerKeys.embedding.has(VOLCENGINE_AGENT_PLAN_PROVIDER_KEY),
    false,
  );
});
