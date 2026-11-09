import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import {
  AesGcmPayloadCryptoService,
  StaticAesGcmEncryptionKeyResolver,
} from "../../src/services/aes-gcm-payload-crypto.service.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import {
  PersonalModelService,
  captureModel,
} from "../../src/modules/lighttick/personal-model/personal-model.service.ts";
const o = { appId: "lighttick" as const, userId: "synthetic-model" };
function setup() {
  const repo = new InMemoryLightTickRepository(),
    crypto = new AesGcmPayloadCryptoService(
      new StaticAesGcmEncryptionKeyResolver({
        fixture: Buffer.alloc(32, 7).toString("base64"),
      }),
    ),
    queue = new InMemoryJobQueue(),
    s = new PersonalModelService(
      repo,
      crypto,
      async () => "fixture",
      queue,
      async () => {},
      () => new Date("2026-11-05T08:00:00Z"),
    );
  const b = {
    base_revision: 0,
    mode: "personal",
    base_url: "https://model.example/v1",
    model_name: "synthetic-model",
    api_key: "SYNTHETIC_PRIVATE_KEY",
  };
  return { repo, s, b, queue };
}
test("personal model is owner isolated, encrypted, CAS, replayable and clears without plaintext receipts", async () => {
  const { repo, s, b } = setup();
  const first = await s.configure(o, b, "settings-original");
  assert.equal(first.configured, true);
  assert.equal(
    JSON.stringify(await repo.getOperation(o, "settings-original")).includes(
      b.api_key,
    ),
    false,
  );
  assert.equal(
    JSON.stringify(await repo.personalModels.get(o)).includes(b.api_key),
    false,
  );
  const sel = await captureModel(repo, o);
  assert.equal((await s.credentials(o, sel)).api_key, b.api_key);
  assert.equal((await s.summary({ ...o, userId: "other" })).revision, 0);
  await s.configure(
    o,
    {
      base_revision: 1,
      mode: "platform",
      base_url: null,
      model_name: null,
      api_key: null,
    },
    "clear-original",
  );
  assert.deepEqual(await s.configure(o, b, "settings-original"), first);
  assert.deepEqual(await s.receipt(o, "settings-original"), first);
  await assert.rejects(
    s.configure(o, { ...b, api_key: "different" }, "settings-original"),
    { statusCode: 409 },
  );
  await assert.rejects(s.credentials(o, sel), { statusCode: 409 });
  assert.equal((await repo.personalModels.get(o))?.secret, null);
});
test("settings fail closed for local addresses, receipt crashes and test revision/budget conflicts", async () => {
  const { repo, s, b } = setup();
  for (const u of [
    "http://localhost:11434/v1",
    "https://127.0.0.1/v1",
    "https://[::1]/v1",
    "https://model.example:8080/v1",
    "https://user:pass@model.example/v1",
  ])
    await assert.rejects(
      s.configure(o, { ...b, base_url: u }, "invalid-original"),
      { statusCode: 422 },
    );
  const save = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("crash");
  };
  await assert.rejects(s.configure(o, b, "settings-original"));
  assert.equal(await repo.personalModels.get(o), undefined);
  repo.saveOperation = save;
  await s.configure(o, b, "settings-original");
  const t = await s.createTest(o, { settings_revision: 1 }, "test-original");
  assert.deepEqual(
    await s.createTest(o, { settings_revision: 1 }, "test-original"),
    t,
  );
  await assert.rejects(
    s.createTest(o, { settings_revision: 1 }, "another-test"),
    { statusCode: 429 },
  );
  assert.equal(
    (await s.cancelTest(o, t.id, { base_revision: 1 }, "cancel-original"))
      .status,
    "cancelled",
  );
  repo.personalModels.deleteOwner(o);
  assert.equal((await s.summary(o)).revision, 0);
});
test("personal dispatcher uses selected exact model, no platform fallback, rejects truncated output and changed settings", async () => {
  const { s, b } = setup();
  await s.configure(o, b, "settings-original");
  let platform = 0,
    calls: any[] = [];
  const { PersonalModelDispatcher, selectionOption } =
    await import("../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts");
  const response = (reason = "stop") =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "OK" }, finish_reason: reason }],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  const transport = async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return response();
  };
  const d = new PersonalModelDispatcher(
      s,
      {
        complete: async () => {
          platform++;
          throw Error("unexpected");
        },
      },
      transport as any,
    ),
    req = {
      modelKey: "platform-ignored",
      messages: [{ role: "user" as const, content: "Synthetic" }],
      usageOwner: o,
      providerOptions: selectionOption({ mode: "personal", revision: 1 }),
    };
  assert.equal((await d.complete(req)).providerModel, b.model_name);
  assert.equal(calls[0].model, b.model_name);
  assert.equal(calls[0].zookLightTickModelSelection, undefined);
  assert.equal(platform, 0);
  await assert.rejects(
    new PersonalModelDispatcher(s, d.platform, (async () =>
      response("length")) as any).complete(req),
    { statusCode: 502 },
  );
  await assert.rejects(
    new PersonalModelDispatcher(
      s,
      d.platform,
      (async () => new Promise(() => {})) as any,
      5,
    ).complete(req),
    { statusCode: 504 },
  );
  await s.configure(
    o,
    { ...b, base_revision: 1, model_name: "changed" },
    "settings-changed",
  );
  await assert.rejects(d.complete(req), { statusCode: 409 });
  assert.equal(platform, 0);
});
test("model connection work is durable, cancel-fenced, recoverable and cannot publish after configuration changes", async () => {
  const { s, b, repo } = setup();
  await s.configure(o, b, "settings-original");
  const { PersonalModelDispatcher } =
    await import("../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts");
  const { PersonalModelTestRunner } =
    await import("../../src/modules/lighttick/personal-model/personal-model-test.runner.ts");
  let release!: (r: Response) => void;
  const d = new PersonalModelDispatcher(
    s,
    {
      complete: async () => {
        throw Error("no fallback");
      },
    },
    (async () => new Promise<Response>((r) => (release = r))) as any,
  );
  const r = new PersonalModelTestRunner(s, d);
  const t = await s.createTest(o, { settings_revision: 1 }, "test-original");
  const task = r.execute(o, t.id);
  const deadline = Date.now() + 5000;
  while (!release) {
    assert.ok(Date.now() < deadline, "transport was not called");
    await new Promise((r) => setTimeout(r, 1));
  }
  const running = await s.readTest(o, t.id);
  await s.cancelTest(
    o,
    t.id,
    { base_revision: running.revision },
    "cancel-original",
  );
  release(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      }),
    ),
  );
  await task;
  assert.equal((await s.readTest(o, t.id)).status, "cancelled");
  assert.equal((await repo.personalModels.test(o, t.id))?.fence, null);
  assert.equal(await r.recover(), 0);
});
test("unsaved tests preserve browser-era test-before-save, encrypt temporary inputs, recover by original key and scrub secrets", async () => {
  const { s, repo, b } = setup();
  const { PersonalModelDispatcher } =
    await import("../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts");
  const { PersonalModelTestRunner } =
    await import("../../src/modules/lighttick/personal-model/personal-model-test.runner.ts");
  const body = {
      settings_revision: 0,
      config: {
        base_url: b.base_url,
        model_name: b.model_name,
        api_key: b.api_key,
      },
    },
    t = await s.createTest(o, body, "draft-test-original");
  assert.equal(t.target, "draft");
  assert.equal((await s.summary(o)).revision, 0);
  assert.equal(
    JSON.stringify(await repo.getOperation(o, "draft-test-original")).includes(
      b.api_key,
    ),
    false,
  );
  assert.equal(
    JSON.stringify(await repo.personalModels.test(o, t.id)).includes(b.api_key),
    false,
  );
  const d = new PersonalModelDispatcher(
    s,
    {
      complete: async () => {
        throw Error("unexpected");
      },
    },
    (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        }),
      )) as any,
  );
  await new PersonalModelTestRunner(s, d).execute(o, t.id);
  assert.equal(
    (await s.testReceipt(o, "draft-test-original")).status,
    "succeeded",
  );
  assert.equal((await s.summary(o)).revision, 0);
  assert.equal((await repo.personalModels.test(o, t.id))?.draft_secret, null);
  assert.equal((await s.createTest(o, body, "draft-test-original")).id, t.id);
});
test("private model master key is shared across worker instances through platform KV, not a public log-upload key", async () => {
  const { KVManager, InMemoryKVBackend } =
    await import("../../src/infrastructure/kv/kv-manager.ts");
  const { PersonalModelKeyResolver } =
    await import("../../src/modules/lighttick/personal-model/personal-model.crypto.ts");
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() }),
    a = new PersonalModelKeyResolver(kv),
    b = new PersonalModelKeyResolver(kv);
  assert.equal(await a.resolveKey("v1"), undefined);
  const [left, right] = await Promise.all([a.ensure(), b.ensure()]);
  assert.equal(left, right);
  assert.deepEqual(await a.resolveKey(left), await b.resolveKey(right));
  assert.equal(await a.resolveKey("public-client-log-key"), undefined);
});
test("personal transport rejects mixed/private DNS before sending credentials and rejects local URL aliases", async () => {
  const { fetchPersonalModel } =
    await import("../../src/modules/lighttick/personal-model/personal-model.transport.ts");
  let sent = 0;
  for (const answers of [
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    [{ address: "::1", family: 6 }],
  ])
    await assert.rejects(
      fetchPersonalModel(
        "https://model.example/v1/chat/completions",
        { body: "{}" },
        new AbortController().signal,
        {
          lookup: async () => answers,
          request: () => {
            sent++;
            throw Error("must not send");
          },
        } as any,
      ),
      /ADDRESS_FORBIDDEN/,
    );
  assert.equal(sent, 0);
});
