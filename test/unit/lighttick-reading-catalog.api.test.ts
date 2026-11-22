import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  LightTickReadingCatalogPageEnvelopeSchema,
  LightTickReadingPageEnvelopeSchema,
} from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("HTTP catalog and compatible full library satisfy generated contracts under full/core without leaking original content into previews", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "catalog-http-member",
    appId: "lighttick",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: new Date().toISOString(),
  });
  const runtime = await createApplication({ seed, lighttickEnabled: true }),
    headers = {
      authorization:
        "Bearer " +
        runtime.services.tokenService.issueAccessToken(
          "user_alice",
          "lighttick",
        ),
      "x-app-id": "lighttick",
    },
    ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const call = (path: string, method = "GET", body?: unknown) =>
    runtime.app.handle({
      path: "/api/v1/lighttick/reading" + path,
      method,
      body,
      headers: { ...headers, "idempotency-key": "catalog-http-original" },
    });
  const imported = await call("/articles/article-catalog-http-one", "PUT", {
    base_revision: 0,
    content: {
      title: "HTTP catalog",
      body: "a".repeat(2000) + "exact tail",
      source_url: null,
      language: "en",
      published_at: null,
    },
  });
  assert.equal(imported.statusCode, 200);
  for (const core of [false, true]) {
    if (core)
      await runtime.services.appConfigService.setValue(
        "lighttick",
        "admin.delivery_config",
        JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
      );
    const catalog = await call("/catalog");
    assert.equal(catalog.statusCode, 200);
    const check = ajv.compile(LightTickReadingCatalogPageEnvelopeSchema);
    assert.ok(check(catalog.body), JSON.stringify(check.errors));
    const row = (catalog.body as any).data.items[0];
    assert.equal(row.preview, "a".repeat(160));
    assert.equal(Object.hasOwn(row, "content"), false);
    const full = await call("/library");
    assert.equal(full.statusCode, 200);
    const legacy = ajv.compile(LightTickReadingPageEnvelopeSchema);
    assert.ok(legacy(full.body), JSON.stringify(legacy.errors));
    assert.equal((full.body as any).data.items[0].content.body.length, 2010);
    assert.equal(
      row.content_version,
      (full.body as any).data.items[0].content_version,
    );
  }
});
