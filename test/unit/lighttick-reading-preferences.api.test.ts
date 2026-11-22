import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("canonical setup/preferences/source-delete contracts preserve all metadata and core read-only original receipt recovery", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "reading-prefs-http",
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
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "prefs-http-original",
  ) =>
    runtime.app.handle({
      path: "/api/v1/lighttick/reading" + path,
      method,
      body,
      headers: { ...headers, "idempotency-key": key },
    });
  const check = (name: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const validate = ajv.compile(
      (schemas as any)["LightTickReading" + name + "Schema"],
    );
    assert.ok(validate(r.body), JSON.stringify(validate.errors));
    return r.body.data;
  };
  const initial = check("SetupEnvelope", await call("/setup"));
  assert.equal(initial.default_sources.length, 10);
  assert.equal(initial.preferences.revision, 0);
  const request = {
      base_revision: 0,
      value: {
        ...initial.preferences.value,
        hour: 7,
        minute: 45,
        count: 8,
        auto_guide: true,
      },
    },
    saved = check(
      "PreferencesEnvelope",
      await call("/preferences", "PUT", request, "prefs-http-save"),
    );
  assert.equal(saved.value.auto_guide, true);
  check("PreferencesHistoryEnvelope", await call("/preferences/history"));
  assert.equal(
    (await call("/preferences", "PUT", request, "prefs-http-stale")).statusCode,
    409,
  );
  const source = check(
    "SourceEnvelope",
    await call(
      "/sources/source-preferences-http",
      "PUT",
      {
        base_revision: 0,
        title: "Personal source",
        url: "https://example.com/feed",
        format: "rss",
        archived: false,
        language: "zh",
        topics: ["认知", "成长"],
        domains: ["example.com", "www.example.com"],
        catalog_id: null,
      },
      "prefs-http-source",
    ),
  );
  assert.equal(source.custom, true);
  assert.deepEqual(source.topics, ["认知", "成长"]);
  const removed = check(
    "SourceEnvelope",
    await call(
      "/sources/" + source.id + "/delete",
      "POST",
      { base_revision: 1 },
      "prefs-http-source-delete",
    ),
  );
  assert.ok(removed.deleted_at);
  check("SourcePageEnvelope", await call("/sources"));
  check("ExportEnvelope", await call("/export"));
  await runtime.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  check("PreferencesEnvelope", await call("/preferences"));
  check("SetupEnvelope", await call("/setup"));
  check("PreferencesHistoryEnvelope", await call("/preferences/history"));
  const receipt = check(
    "WorkReceiptEnvelope",
    await call("/work-receipts/prefs-http-save"),
  );
  assert.deepEqual(receipt.result, saved);
  assert.equal(
    (await call("/preferences", "PUT", request, "prefs-http-save")).statusCode,
    503,
  );
  assert.equal(
    (
      await call(
        "/sources/" + source.id + "/delete",
        "POST",
        { base_revision: 2 },
        "prefs-http-core-delete",
      )
    ).statusCode,
    503,
  );
  assert.equal(
    (await call("/sources/" + source.id + "/delete")).statusCode,
    405,
  );
});
