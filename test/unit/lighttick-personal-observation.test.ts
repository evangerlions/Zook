import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { AesGcmPayloadCryptoService, StaticAesGcmEncryptionKeyResolver } from "../../src/services/aes-gcm-payload-crypto.service.ts";
import { PersonalModelService } from "../../src/modules/lighttick/personal-model/personal-model.service.ts";
import { PersonalModelDispatcher } from "../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts";
import { InMemoryLlmObservabilityStore } from "../../src/testing/in-memory-llm-observability-store.ts";

const owner = { appId: "lighttick" as const, userId: "personal-observation" };
const request = { messages: [{ role: "user", content: "hi" }], usageOwner: owner, providerOptions: {} } as any;

function setup(transport: (url: string, init: RequestInit) => Promise<Response>) {
  let now = new Date("2026-11-27T08:00:00Z");
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue(),
    settings = new PersonalModelService(
      repo,
      new AesGcmPayloadCryptoService(new StaticAesGcmEncryptionKeyResolver({ fixture: Buffer.alloc(32, 9).toString("base64") })),
      async () => "fixture",
      queue,
      async () => {},
      () => new Date(now),
    ),
    observations = new InMemoryLlmObservabilityStore(),
    dispatcher = new PersonalModelDispatcher(
      settings,
      { complete: async () => { throw Error("platform must not be used"); } } as any,
      transport as any,
      undefined,
      undefined,
      observations,
      () => new Date(now),
    );
  return { settings, dispatcher, observations, setNow: (iso: string) => { now = new Date(iso); } };
}

const credentials = { base_revision: 0, mode: "personal", base_url: "https://model.example/v1", model_name: "measured-model", api_key: "SYNTHETIC" };

test("personal generation records an observation with provider usage so cost is auditable", async () => {
  let f: ReturnType<typeof setup>;
  f = setup(async () => {
    f.setNow("2026-11-27T08:00:02Z");
    return new Response(JSON.stringify({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }));
  });
  await f.settings.configure(owner, credentials, "obs-configure-1");
  const result = await f.dispatcher.personal(owner, { mode: "personal", revision: 1 } as any, request);
  assert.equal(result.text, "ok");
  assert.equal(f.observations.observations.length, 1);
  const record = f.observations.observations[0]!;
  assert.equal(record.appId, "lighttick");
  assert.equal(record.routingModelKey, "lighttick.personal");
  assert.equal(record.provider, "personal");
  assert.equal(record.providerModel, "measured-model");
  assert.equal(record.operation, "chat");
  assert.equal(record.responseMode, "non_stream");
  assert.equal(record.outcome, "success");
  assert.equal(record.healthImpact, "success");
  assert.equal(record.promptTokens, 11);
  assert.equal(record.completionTokens, 7);
  assert.equal(record.totalTokens, 18);
  assert.equal(record.usageSource, "provider");
  assert.equal(record.totalLatencyMs, 2000);
});

test("a failed personal generation records the failure with missing usage instead of silence", async () => {
  const f = setup(async () => { throw Error("upstream exploded"); });
  await f.settings.configure(owner, credentials, "obs-configure-2");
  await assert.rejects(f.dispatcher.personal(owner, { mode: "personal", revision: 1 } as any, request));
  assert.equal(f.observations.observations.length, 1);
  const record = f.observations.observations[0]!;
  assert.equal(record.outcome, "failure");
  assert.equal(record.healthImpact, "failure");
  assert.equal(record.usageSource, "missing");
  assert.equal(record.errorCode, "LLM_PROVIDER_REQUEST_FAILED");
  assert.equal(record.providerModel, "measured-model", "凭据已取到，失败也记真实模型名");
});
