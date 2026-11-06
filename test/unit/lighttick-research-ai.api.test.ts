import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { ResearchService } from "../../src/modules/lighttick/investments/research/research.service.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
test("research HTTP freezes selected personal model, uses real attached worker, produces secret-free AJV artifact and enforces membership", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "research-ai-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    runtime = app.services.lighttickRuntime!,
    o = { appId: "lighttick" as const, userId: "user_alice" },
    r = new ResearchService(runtime.repository),
    id = "inv-http-ai-research";
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
      title: "Synthetic dossier",
      horizon: "short",
      market_sources: [],
      evidence: [],
      ...Object.fromEntries(researchFields.map((k) => [k, ""])),
    },
    "research-original",
  );
  await runtime.personalModel!.configure(
    o,
    {
      base_revision: 0,
      mode: "personal",
      base_url: "https://model.example/v1",
      model_name: "selected-research-model",
      api_key: "SYNTHETIC_PRIVATE_KEY",
    },
    "model-original",
  );
  let calls = 0;
  (runtime.personalModelDispatcher as any).transport = async (
    _url: any,
    init: any,
  ) => {
    calls++;
    const b = JSON.parse(init.body);
    assert.equal(b.model, "selected-research-model");
    assert.ok(!JSON.stringify(b).includes("SYNTHETIC_PRIVATE_KEY"));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "Analysis",
                limitations: "Missing quotes",
                citations: ["research:" + id + ":1"],
              }),
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
  };
  const call = (
    suffix: string,
    method = "GET",
    body?: unknown,
    key = "http-original",
    user = "user_alice",
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/investments/research-ai" + suffix,
      body,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(
    schemas.LightTickInvestmentResearchAIWorkEnvelopeSchema,
  );
  const b = {
    research_id: id,
    base_revision: 1,
    kind: "analysis",
    consent: true,
    model_mode: "personal",
    model_revision: 1,
  };
  const created = await call("", "POST", b);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const work = (created.body as any).data;
  await runtime.worker!.researchAI!.execute(o, work.id);
  const response = await call("/" + work.id);
  assert.ok(validate(response.body), JSON.stringify(validate.errors));
  const done = (response.body as any).data;
  assert.equal(done.status, "succeeded");
  assert.equal(calls, 1);
  assert.equal(done.output.model, "selected-research-model");
  assert.ok(!JSON.stringify(done).includes("SYNTHETIC_PRIVATE_KEY"));
  assert.equal(done.adopted_at, null);
  await call("", "POST", b);
  assert.equal(calls, 1);
  assert.equal(
    (await call("/" + work.id, "GET", undefined, "unused-original", "user_bob"))
      .statusCode,
    404,
  );
  const adopted = await call(
    "/" + work.id + "/adopt",
    "POST",
    { base_revision: done.revision },
    "adopt-original",
  );
  assert.equal(adopted.statusCode, 200);
  assert.ok((adopted.body as any).data.adopted_at);
  const anon = await app.app.handle({
    method: "GET",
    path: "/api/v1/lighttick/investments/research-ai/" + work.id,
    headers: { "x-app-id": "lighttick" },
  });
  assert.equal(anon.statusCode, 401);
  await runtime.personalModel!.configure(
    o,
    {
      base_revision: 1,
      mode: "platform",
      base_url: null,
      model_name: null,
      api_key: null,
    },
    "clear-model-original",
  );
  assert.equal(
    (await call("", "POST", b, "stale-model-request")).statusCode,
    409,
  );
  assert.equal(calls, 1);
});
