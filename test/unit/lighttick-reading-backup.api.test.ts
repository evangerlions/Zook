import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("HTTP reading backups capture and recover originals in core, satisfy generated contracts, retain exact detail and delete only artifacts", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "backup-http-member",
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
      key = "backup-http-original",
    ) =>
      runtime.app.handle({
        path: "/api/v1/lighttick/reading" + path,
        method,
        body,
        headers: { ...headers, "idempotency-key": key },
      }),
    check = (name: string, r: any) => {
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));
      const validate = ajv.compile(
        (schemas as any)["LightTickReadingBackup" + name + "EnvelopeSchema"],
      );
      assert.ok(validate(r.body), JSON.stringify(validate.errors));
      return r.body.data;
    };
  const article = await call(
    "/articles/article-backup-http-original",
    "PUT",
    {
      base_revision: 0,
      content: {
        title: "Backup original",
        body: "Original bytes 🙂",
        source_url: null,
        language: "en",
        published_at: null,
      },
    },
    "backup-http-import",
  );
  assert.equal(article.statusCode, 200);
  await runtime.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  const body = { format: "lighttick-reading-ndjson-v2" },
    manifest = check("Manifest", await call("/backups", "POST", body));
  assert.equal(manifest.counts.articles, 1);
  assert.equal(manifest.counts.article_versions, 1);
  assert.equal(manifest.counts.receipts, 1);
  assert.equal(manifest.counts.work, 0);
  assert.deepEqual(
    check("Receipt", await call("/backup-receipts/backup-http-original")),
    manifest,
  );
  assert.deepEqual(
    check("Manifest", await call("/backups", "POST", body)),
    manifest,
  );
  assert.equal(check("Page", await call("/backups")).items.length, 1);
  assert.deepEqual(
    check("Manifest", await call("/backups/" + manifest.id)),
    manifest,
  );
  const part = check(
    "Part",
    await call("/backups/" + manifest.id + "/parts/0"),
  );
  assert.ok(
    Buffer.from(part.data_base64, "base64")
      .toString("utf8")
      .includes("Original bytes 🙂"),
  );
  const deleted = check(
    "Deleted",
    await call(
      "/backups/" + manifest.id + "/delete",
      "POST",
      { base_revision: 1 },
      "backup-http-delete",
    ),
  );
  assert.equal(deleted.deleted, true);
  assert.deepEqual(
    check("Receipt", await call("/backup-receipts/backup-http-delete")),
    deleted,
  );
  assert.equal(
    (await call("/backups/" + manifest.id + "/parts/0")).statusCode,
    404,
  );
  assert.equal(
    (await call("/articles/article-backup-http-original")).statusCode,
    200,
  );
  assert.equal(check("Page", await call("/backups")).items.length, 0);
  assert.deepEqual(
    check("Manifest", await call("/backups", "POST", body)),
    manifest,
  );
  assert.equal(check("Page", await call("/backups")).items.length, 0);
});
