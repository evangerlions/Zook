import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import {
  AesGcmPayloadCryptoService,
  StaticAesGcmEncryptionKeyResolver,
} from "../../src/services/aes-gcm-payload-crypto.service.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import {
  PersonalModelService,
  captureModel,
} from "../../src/modules/lighttick/personal-model/personal-model.service.ts";
import { PersonalModelDispatcher } from "../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts";
import { PersonalModelTestRunner } from "../../src/modules/lighttick/personal-model/personal-model-test.runner.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable synthetic localhost database required");
test("PG personal credentials/replay survive reconnect, roll back atomically, recover tests and leave no secrets after owner deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "model-pg-" + process.pid },
    queue = new InMemoryJobQueue(),
    crypto = new AesGcmPayloadCryptoService(
      new StaticAesGcmEncryptionKeyResolver({
        fixture: Buffer.alloc(32, 8).toString("base64"),
      }),
    );
  let now = new Date("2026-11-05T08:00:00Z");
  const s = new PersonalModelService(
      repo,
      crypto,
      async () => "fixture",
      queue,
      async () => {},
      () => now,
    ),
    body = {
      base_revision: 0,
      mode: "personal",
      base_url: "https://model.example/v1",
      model_name: "model-fixture",
      api_key: "SYNTHETIC_PRIVATE_KEY",
    };
  try {
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("receipt crash");
    };
    await assert.rejects(s.configure(o, body, "settings-original"));
    assert.equal(await other.personalModels.get(o), undefined);
    repo.saveOperation = save;
    const first = await s.configure(o, body, "settings-original"),
      reconnect = new PersonalModelService(
        other,
        crypto,
        async () => "fixture",
        queue,
      );
    assert.deepEqual(await reconnect.summary(o), first);
    assert.equal(
      (await reconnect.credentials(o, await captureModel(other, o))).api_key,
      body.api_key,
    );
    assert.equal(
      JSON.stringify(
        (
          await pool.query(
            "SELECT payload FROM zook_lighttick_personal_model WHERE user_id=$1",
            [o.userId],
          )
        ).rows,
      ).includes(body.api_key),
      false,
    );
    assert.equal(
      JSON.stringify(await repo.getOperation(o, "settings-original")).includes(
        body.api_key,
      ),
      false,
    );
    const both = await Promise.allSettled([
      s.configure(
        o,
        { ...body, base_revision: 1, model_name: "left" },
        "settings-left",
      ),
      reconnect.configure(
        o,
        { ...body, base_revision: 1, model_name: "right" },
        "settings-right",
      ),
    ]);
    assert.equal(both.filter((r) => r.status === "fulfilled").length, 1);
    assert.deepEqual(await s.configure(o, body, "settings-original"), first);
    const t = await s.createTest(o, { settings_revision: 2 }, "test-original"),
      raw = (await repo.personalModels.test(o, t.id))!;
    await repo.transaction(o, () =>
      repo.personalModels.saveTest(
        {
          ...raw,
          status: "running",
          revision: 2,
          attempt: 1,
          fence: "old-fence",
          lease_until: new Date(now.getTime() - 1).toISOString(),
        },
        1,
      ),
    );
    const d = new PersonalModelDispatcher(
        s,
        {
          complete: async () => {
            throw Error("no fallback");
          },
        },
        (async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
            }),
          )) as any,
      ),
      r = new PersonalModelTestRunner(s, d);
    assert.equal(await r.recover(), 1);
    await r.execute(o, t.id);
    assert.equal((await reconnect.readTest(o, t.id)).status, "succeeded");
    await r.execute(o, t.id);
    assert.equal((await repo.personalModels.test(o, t.id))?.attempt, 2);
    await assert.rejects(
      reconnect.readTest({ ...o, userId: "foreign" }, t.id),
      { statusCode: 404 },
    );
    await repo.deleteOwnerData(o);
    assert.equal(await other.personalModels.get(o), undefined);
    assert.equal(await other.personalModels.test(o, t.id), undefined);
    assert.equal(await other.getOperation(o, "settings-original"), undefined);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});
test('private master key persists in real Redis across independent clients and decrypts the owner PG row after reconnect',async()=>{
 const url=process.env.LIGHTTICK_MODEL_TEST_REDIS_URL;if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='58632')throw Error('Dedicated synthetic localhost Redis required');
 const {KVManager}=await import('../../src/infrastructure/kv/kv-manager.ts'),{PersonalModelKeyResolver}=await import('../../src/modules/lighttick/personal-model/personal-model.crypto.ts');const pool=new Pool({connectionString:dsn}),repo=new PostgresLightTickRepository(pool),o={appId:'lighttick' as const,userId:'model-redis-pg-'+process.pid},queue=new InMemoryJobQueue(),first=await KVManager.create({redisUrl:url});let second:Awaited<ReturnType<typeof KVManager.create>>|undefined;
 try{const a=new PersonalModelKeyResolver(first),s=new PersonalModelService(repo,new AesGcmPayloadCryptoService(a),()=>a.ensure(),queue);await s.configure(o,{base_revision:0,mode:'personal',base_url:'https://model.example/v1',model_name:'synthetic',api_key:'SYNTHETIC_PRIVATE_KEY'},'redis-original');await first.disconnect();second=await KVManager.create({redisUrl:url});const b=new PersonalModelKeyResolver(second),restarted=new PersonalModelService(new PostgresLightTickRepository(pool),new AesGcmPayloadCryptoService(b),()=>b.ensure(),queue);assert.equal((await restarted.credentials(o,{mode:'personal',revision:1})).api_key,'SYNTHETIC_PRIVATE_KEY');assert.equal((await restarted.summary(o)).revision,1);}finally{await repo.deleteOwnerData(o);await second?.disconnect();await first.disconnect();await pool.end();}
});
