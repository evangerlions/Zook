import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ResearchService } from "../../src/modules/lighttick/investments/research/research.service.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
import { ResearchAIService } from "../../src/modules/lighttick/investments/research-ai/research-ai.service.ts";
import { ResearchAIRunner } from "../../src/modules/lighttick/investments/research-ai/research-ai.runner.ts";
import { PersonalModelService } from "../../src/modules/lighttick/personal-model/personal-model.service.ts";
import { PersonalModelDispatcher } from "../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts";
import {
  AesGcmPayloadCryptoService,
  StaticAesGcmEncryptionKeyResolver,
} from "../../src/services/aes-gcm-payload-crypto.service.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Dedicated synthetic PG required");
test("PG research AI atomic receipt, reconnect, expired lease recovery, adopt CAS and owner deletion with actual personal dispatcher", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    o = {
      appId: "lighttick" as const,
      userId: "research-ai-pg-" + process.pid,
    },
    id = "inv-research-pg-original",
    queue = new InMemoryJobQueue(),
    s = new ResearchAIService(repo, queue),
    r = new ResearchService(repo);
  try {
    const symbol = (
      await r.createInstrument(
        o,
        { code: "600000", market: "SSE", kind: "stock", name: "Synthetic" },
        "symbol-original",
      )
    ).instrument;
    await r.write(
      o,
      id,
      {
        base_revision: 0,
        instrument_id: symbol.id,
        account_id: null,
        title: "Synthetic",
        horizon: "short",
        market_sources: [],
        evidence: [],
        ...Object.fromEntries(researchFields.map((k) => [k, ""])),
      },
      "research-original",
    );
    const crypto = new AesGcmPayloadCryptoService(
        new StaticAesGcmEncryptionKeyResolver({
          fixture: Buffer.alloc(32, 9).toString("base64"),
        }),
      ),
      settings = new PersonalModelService(
        repo,
        crypto,
        async () => "fixture",
        queue,
      );
    await settings.configure(
      o,
      {
        base_revision: 0,
        mode: "personal",
        base_url: "https://model.example/v1",
        model_name: "personal-fixture",
        api_key: "SYNTHETIC_KEY",
      },
      "model-original",
    );
    const body = {
      research_id: id,
      base_revision: 1,
      kind: "report",
      consent: true,
      model_mode: "personal",
      model_revision: 1,
    };
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("receipt crash");
    };
    await assert.rejects(s.create(o, body, "create-original"));
    assert.equal((await other.researchAI.list(o)).length, 0);
    repo.saveOperation = save;
    const work = await s.create(o, body, "create-original"),
      restart = new ResearchAIService(other, queue),
      row = (await other.researchAI.get(o, work.id))!;
    await other.transaction(o, () =>
      other.researchAI.save(
        {
          ...row,
          revision: 2,
          status: "running",
          attempt: 1,
          fence: "crashed",
          lease_until: "2020-01-01T00:00:00Z",
        },
        1,
      ),
    );
    let calls = 0;
    const dispatcher = new PersonalModelDispatcher(
      new PersonalModelService(other, crypto, async () => "fixture", queue),
      {
        complete: async () => {
          throw Error("no fallback");
        },
      },
      async () => {
        calls++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    text: "Synthetic report",
                    citations: ["research:" + id + ":1"],
                    limitations: "Missing live quotes",
                  }),
                },
                finish_reason: "stop",
              },
            ],
          }),
        );
      },
    );
    const runner = new ResearchAIRunner(restart, dispatcher);
    assert.ok((await runner.recover()) >= 1);
    await runner.execute(o, work.id);
    const done = await restart.readWork(o, work.id);
    assert.equal(done.status, "succeeded");
    assert.equal(calls, 1);
    assert.equal(
      (await restart.create(o, body, "create-original")).id,
      work.id,
    );
    assert.equal(calls, 1);
    const results = await Promise.allSettled(
      ["adopt-first", "adopt-second"].map((key) =>
        restart.mutate(
          o,
          work.id,
          "adopt",
          { base_revision: done.revision },
          key,
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await other.investments.research.get(o, id))?.revision, 1);
    await other.deleteOwnerData(o);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_research_ai WHERE user_id=$1",
          [o.userId],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await other.deleteOwnerData(o);
    await pool.end();
  }
});
