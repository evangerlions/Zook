import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("independent reading HTTP auth, generated contracts, receipts, history, export and core scope", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "reading-member",
    appId: "lighttick",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const headers = {
    authorization:
      "Bearer " +
      app.services.tokenService.issueAccessToken("user_alice", "lighttick"),
    "x-app-id": "lighttick",
    "idempotency-key": "reading-http-original",
  };
  const call = (path: string, method = "GET", body?: unknown, h = headers) =>
    app.app.handle({
      path: "/api/v1/lighttick/reading" + path,
      method,
      body,
      headers: h,
    });
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = (name: string, response: any) => {
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    const check = ajv.compile(
      (schemas as any)["LightTickReading" + name + "EnvelopeSchema"],
    );
    assert.equal(check(response.body), true, JSON.stringify(check.errors));
  };
  const input = {
    base_revision: 0,
    content: {
      title: "阅读API",
      body: "原文",
      source_url: null,
      language: "zh",
      published_at: null,
    },
  };
  const result = await call("/articles/article-http-original", "PUT", input);
  validate("Article", result);
  validate("Article", await call("/articles/article-http-original"));
  validate("Page", await call("/library"));
  validate(
    "HistoryPage",
    await call("/articles/article-http-original/history"),
  );
  validate("Article", await call("/receipts/reading-http-original"));
  validate("Export", await call("/export"));
  assert.equal(
    (
      await call("/articles/article-http-original", "PUT", input, {
        "x-app-id": "lighttick",
      } as typeof headers)
    ).statusCode,
    401,
  );
  await app.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  validate("Article", await call("/articles/article-http-original"));
  const blocked = await call("/articles/article-http-new", "PUT", input);
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.body.code, "LIGHTTICK_CAPABILITY_UNAVAILABLE");
});
