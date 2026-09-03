import assert from "node:assert/strict";
import test from "node:test";
import type { CommonLlmConfigService } from "../../src/services/common-llm-config.service.ts";
import { resolveAiNovelRoutingIdentity } from "../../src/modules/ai-novel/ai-novel-routing-identity.ts";
import { EmbeddingManager } from "../../src/services/embedding-manager.ts";
import type { LlmHealthService } from "../../src/services/llm-health.service.ts";
import {
  resolveLlmRoutingUnit,
} from "../../src/services/llm-routing-affinity.ts";
import {
  LLMManager,
  type LLMProvider,
} from "../../src/services/llm-manager.ts";
import type { LlmServiceConfig } from "../../src/shared/types.ts";

const config: LlmServiceConfig = {
  enabled: true,
  defaultModelKey: "chat-model",
  openRouter: {
    useTransparentProxy: false,
    transparentProxyBaseUrl: "",
    transparentProxyKeyId: "",
    transparentProxyHmacSecretKey: "",
  },
  providers: [
    providerConfig("provider-a"),
    providerConfig("provider-b"),
  ],
  models: [
    modelConfig("chat-model", "chat"),
    modelConfig("embedding-model", "embedding"),
  ],
};

test("routing unit is stable for the same DID and UID suffixes", () => {
  const first = resolveLlmRoutingUnit(
    "web_mf123_deviceabc",
    "user_accountxyz",
  );
  const second = resolveLlmRoutingUnit(
    "web_mf123_deviceabc",
    "user_accountxyz",
  );

  assert.equal(first, second);
  assert.equal(first >= 0 && first < 1, true);
});

test("AINovel reads X-Did case-insensitively and combines it with auth UID", () => {
  assert.deepEqual(
    resolveAiNovelRoutingIdentity(
      { "x-DID": "web_mf123_deviceabc" },
      "user_accountxyz",
    ),
    {
      did: "web_mf123_deviceabc",
      uid: "user_accountxyz",
    },
  );
});

test("routing unit combines both DID and UID suffixes", () => {
  const baseline = resolveLlmRoutingUnit("device_abc", "user_xyz");

  assert.notEqual(
    resolveLlmRoutingUnit("device_abd", "user_xyz"),
    baseline,
  );
  assert.notEqual(
    resolveLlmRoutingUnit("device_abc", "user_xyy"),
    baseline,
  );
});

test("additive routing covers all one-thousand buckets evenly", () => {
  const buckets = new Set<number>();
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const didSuffix = suffix.toString(36).padStart(3, "0");
    const unit = resolveLlmRoutingUnit(`device_${didSuffix}`, "user_001");
    buckets.add(unit * 1_000);
  }

  assert.equal(buckets.size, 1_000);
});

test("routing unit replaces invalid or short DID and UID inputs with random parts", () => {
  const originalRandom = Math.random;
  const values = [0.17, 0.83, 0.1, 0.2];
  Math.random = () => values.shift() ?? 0;
  try {
    assert.equal(resolveLlmRoutingUnit("", "user_000"), 0.17);
    assert.equal(resolveLlmRoutingUnit("device_000", "x"), 0.83);
    assert.equal(resolveLlmRoutingUnit(undefined, undefined), 0.3);
  } finally {
    Math.random = originalRandom;
  }
});

test("chat auto routing keeps one DID and UID on the same provider", async () => {
  const calls: string[] = [];
  let favorProviderA = true;
  const manager = new LLMManager(
    {
      "provider-a": chatProvider("provider-a", calls),
      "provider-b": chatProvider("provider-b", calls),
    },
    undefined,
    {
      commonLlmConfigService: configService(config),
      llmHealthService: {
        async getRouteSnapshot(route) {
          return {
            healthScore: route.provider === "provider-a"
              ? favorProviderA ? 100 : 0
              : favorProviderA ? 0 : 100,
          };
        },
      } as LlmHealthService,
      random: alternatingRandom(),
    },
  );

  for (let index = 0; index < 4; index += 1) {
    await manager.complete({
      modelKey: "chat-model",
      messages: [{ role: "user", content: "hello" }],
      routingIdentity: {
        did: "web_mf123_deviceabc",
        uid: "user_accountxyz",
      },
    });
  }
  favorProviderA = false;
  for (let index = 0; index < 4; index += 1) {
    await manager.complete({
      modelKey: "chat-model",
      messages: [{ role: "user", content: "hello again" }],
      routingIdentity: {
        did: "web_mf123_deviceabc",
        uid: "user_accountxyz",
      },
    });
  }

  assert.equal(new Set(calls).size, 1);
});

test("embedding auto routing uses the same stable routing identity", async () => {
  const calls: string[] = [];
  const manager = new EmbeddingManager(
    {
      "provider-a": embeddingProvider("provider-a", calls),
      "provider-b": embeddingProvider("provider-b", calls),
    },
    undefined,
    {
      commonLlmConfigService: configService(config),
      random: alternatingRandom(),
    },
  );

  for (let index = 0; index < 8; index += 1) {
    await manager.embed({
      modelKey: "embedding-model",
      input: ["hello"],
      routingIdentity: {
        did: "web_mf123_deviceabc",
        uid: "user_accountxyz",
      },
    });
  }

  assert.equal(new Set(calls).size, 1);
});

function providerConfig(key: string) {
  return {
    key,
    label: key,
    enabled: true,
    baseUrl: `https://${key}.example.test/v1`,
    apiKey: `${key}-key`,
    timeoutMs: 30_000,
  };
}

function modelConfig(key: string, kind: "chat" | "embedding") {
  return {
    key,
    label: key,
    kind,
    strategy: "auto" as const,
    routes: [
      routeConfig("provider-a", 50),
      routeConfig("provider-b", 50),
    ],
  };
}

function routeConfig(provider: string, weight: number) {
  return {
    provider,
    providerModel: "upstream-model",
    enabled: true,
    weight,
  };
}

function configService(value: LlmServiceConfig): CommonLlmConfigService {
  return {
    async getRuntimeConfigSnapshot() {
      return {
        config: value,
        revision: 1,
        updatedAt: "2026-09-03T00:00:00.000Z",
      };
    },
  } as CommonLlmConfigService;
}

function alternatingRandom(): () => number {
  let next = 0.1;
  return () => {
    const current = next;
    next = next === 0.1 ? 0.9 : 0.1;
    return current;
  };
}

function chatProvider(name: string, calls: string[]): LLMProvider {
  return {
    async complete(request) {
      assert.equal("routingIdentity" in request, false);
      calls.push(name);
      return {
        provider: name,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "ok",
      };
    },
    async *stream() {
      yield { type: "done" as const };
    },
  };
}

function embeddingProvider(name: string, calls: string[]) {
  return {
    async embed(request: { model: { modelKey: string; providerModel: string } }) {
      assert.equal("routingIdentity" in request, false);
      calls.push(name);
      return {
        provider: name,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        vectors: [{ index: 0, embedding: [0.1] }],
      };
    },
  };
}
