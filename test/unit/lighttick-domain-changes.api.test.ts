import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickDomainChangesEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("HTTP domain changes validate the fixed contract and core remains readonly, private and authorized", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "domain-member",
    appId: "lighttick",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    headers = {
      authorization:
        "Bearer " +
        app.services.tokenService.issueAccessToken("user_alice", "lighttick"),
      "x-app-id": "lighttick",
    };
  const call = (query: Record<string, string> = {}, h = headers) =>
    app.app.handle({
      method: "GET",
      path: "/api/v1/lighttick/domain-changes",
      query,
      headers: h,
    });
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const valid = ajv.compile(LightTickDomainChangesEnvelopeSchema);
  const start = await call({ domain: "reading", start: "latest" });
  assert.equal(start.statusCode, 200, JSON.stringify(start.body));
  assert.ok(valid(start.body), JSON.stringify(valid.errors));
  const created = await app.app.handle({
    method: "PUT",
    path: "/api/v1/lighttick/reading/articles/article-domain-http",
    headers: { ...headers, "idempotency-key": "domain-http-import" },
    body: {
      base_revision: 0,
      content: {
        title: "Private HTTP title",
        body: "Private HTTP original",
        source_url: null,
        language: "en",
        published_at: null,
      },
    },
  });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  await app.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  const page = await call({
    domain: "reading",
    cursor: (start.body as any).data.next_cursor,
  });
  assert.equal(page.statusCode, 200, JSON.stringify(page.body));
  assert.ok(valid(page.body), JSON.stringify(valid.errors));
  assert.equal((page.body as any).data.items.length, 1);
  assert.ok(!JSON.stringify(page.body).includes("Private HTTP"));
  assert.equal(page.headers?.["Cache-Control"], "no-store");
  assert.equal((await call({}, {} as any)).statusCode, 401);
  assert.equal((await call({ limit: "101" })).statusCode, 422);
  assert.equal(
    (
      await call({
        domain: "knowledge",
        cursor: (page.body as any).data.next_cursor,
      })
    ).statusCode,
    409,
  );
});
