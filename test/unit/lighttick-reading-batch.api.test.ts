import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/independent-reading/reading-work.runner.ts";
test("HTTP recommendation scopes, immutable assets, compact original receipts and core recovery obey the canonical contract", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "candidate-http-member",
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
      key = "candidate-http-original",
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
        (schemas as any)["LightTickReading" + name + "Schema"],
      );
      assert.ok(validate(r.body), JSON.stringify(validate.errors));
      return r.body.data;
    };
  const owner = { appId: "lighttick" as const, userId: "user_alice" },
    work = runtime.services.lighttickRuntime.readingWork!;
  const { seedReadingRecommendation, recommendationFeed, recommendationText } =
    await import("../support/reading-recommendation-fixture.ts");
  // Frozen test date gives meaningful dated fixtures; no external provider is called.
  const { ReadingWorkService } = await import(
    "../../src/modules/lighttick/independent-reading/reading-work.service.ts"
  );
  const fixture = new ReadingWorkService(
    work.repo,
    work.queue,
    work.authorize,
    () => new Date("2026-11-12T02:00:00Z"),
  );
  await seedReadingRecommendation(fixture, owner, 1);
  const scope = check(
    "RecommendationScopeEnvelope",
    await call("/recommendation-scope"),
  );
  const request = { scope_digest: scope.digest },
    created = check(
      "WorkEnvelope",
      await call("/recommendations", "POST", request, "batch-http-start"),
    );
  assert.deepEqual(
    check(
      "WorkEnvelope",
      await call("/recommendations", "POST", request, "batch-http-start"),
    ),
    created,
  );
  await new ReadingWorkRunner(
    work,
    {
      complete: async () => {
        throw Error("No model");
      },
    } as any,
    async (url) =>
      url.endsWith("/feed")
        ? {
            body: recommendationFeed(1).replaceAll("2026-11-11", scope.date),
            content_type: "application/rss+xml",
          }
        : { body: recommendationText, content_type: "text/plain" },
  ).execute(owner, created.id);
  const ready = check("WorkEnvelope", await call("/work/" + created.id));
  assert.equal(ready.status, "succeeded");
  const assets = check(
    "AssetPageEnvelope",
    await call("/work/" + created.id + "/assets"),
  );
  assert.equal(assets.items.length, 3);
  const ref = ready.output.entry_refs[0];
  check(
    "AssetEnvelope",
    await call("/work/" + created.id + "/assets/" + ref.asset_id),
  );
  const body = {
    base_revision: ready.revision,
    output_digest: ready.output_digest,
    index: 0,
    base_article_revision: null,
    response_view: "summary",
  };
  const adopted = check(
    "WorkAdoptResultEnvelope",
    await call(
      "/work/" + created.id + "/adopt",
      "POST",
      body,
      "batch-http-adopt",
    ),
  );
  assert.equal("output" in adopted.work, false);
  check("ExportEnvelope", await call("/export"));
  await runtime.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  check(
    "AssetEnvelope",
    await call("/work/" + created.id + "/assets/" + ref.document_id),
  );
  const receipt = check(
    "WorkReceiptEnvelope",
    await call("/work-receipts/batch-http-adopt"),
  );
  assert.deepEqual(receipt.result, adopted);
  assert.equal(
    (await call("/recommendations", "POST", request, "batch-http-new-core"))
      .statusCode,
    503,
  );
});
