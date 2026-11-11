import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("HTTP article-backed practice, exact source/knowledge resolution and separate review facts satisfy canonical contracts in full/core", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "article-source-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const runtime = await createApplication({ seed, lighttickEnabled: true }),
    ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  runtime.services.lighttickRuntime.actionsEnabled = true;
  Object.assign(runtime.services.lighttickRuntime.actions, {
    p0WriteEnabled: true,
  });
  const call = (
      path: string,
      method = "GET",
      body?: unknown,
      key = "article-source-http-original",
      user = "user_alice",
      query: Record<string, string> = {},
    ) =>
      runtime.app.handle({
        path: "/api/v1/lighttick/" + path,
        method,
        body,
        query,
        headers: {
          authorization:
            "Bearer " +
            runtime.services.tokenService.issueAccessToken(user, "lighttick"),
          "x-app-id": "lighttick",
          "x-grow-action-schema": "2",
          "idempotency-key": key,
        },
      }),
    check = (schema: any, r: any) => {
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));
      const validate = ajv.compile(schema);
      assert.ok(validate(r.body), JSON.stringify(validate.errors));
      return r.body.data;
    };
  const body =
    "Exact original ".repeat(15000) + "HTTP full tail private source";
  const article = check(
    schemas.LightTickReadingArticleEnvelopeSchema,
    await call("reading/articles/article-source-http-original", "PUT", {
      base_revision: 0,
      content: {
        title: "Article source HTTP",
        body,
        source_url: null,
        language: "en",
        published_at: null,
      },
    }),
  );
  const input = {
    key: "article-source-http-practice",
    source_kind: "article",
    source_id: article.id,
    source_version: article.content_version,
    title: "Apply reviewed claim",
    date: null,
  };
  const practice = await call("action-plans/practices", "POST", input);
  assert.equal(practice.statusCode, 200, JSON.stringify(practice.body));
  const plan = (practice.body as any).data.plan;
  assert.ok(
    ajv.compile(schemas.LightTickPracticeSourceSchema)(plan.practice_source),
  );
  const receipt = check(
    schemas.LightTickActionRequestReceiptEnvelopeSchema,
    await call("action-plans/requests/" + input.key),
  );
  assert.deepEqual(receipt.result, { plan });
  assert.equal(
    receipt.payload_hash,
    digest({ method: "POST", path: "/practices", body: input }),
  );
  assert.equal(receipt.fingerprint_version, "zook-action-request-v1");
  assert.equal(receipt.action, "/practices");
  const source = check(
    schemas.LightTickPracticeSourceEnvelopeSchema,
    await call("action-plans/practices/" + plan.id + "/source"),
  );
  assert.equal(source.text, body);
  assert.equal(source.source_version, article.content_version);
  assert.equal(
    (
      await call(
        "action-plans/practices",
        "POST",
        { ...input, key: "article-source-foreign" },
        undefined,
        "user_bob",
      )
    ).statusCode,
    404,
  );
  const entry = check(
    schemas.LightTickKnowledgeEntryEnvelopeSchema,
    await call(
      "knowledge/knowledge-article-http",
      "PUT",
      {
        base_revision: 0,
        kind: "knowledge",
        title: "My own interpretation",
        body: "Separately saved reasoning",
        tags: [],
        sources: [
          { kind: "article", id: article.id, version: article.content_version },
        ],
      },
      "article-source-http-knowledge",
    ),
  );
  assert.equal(entry.sources[0].kind, "article");
  const review = check(
    schemas.LightTickReviewSnapshotEnvelopeSchema,
    await call("review", "GET", undefined, undefined, undefined, {
      q: "HTTP full tail private source",
    }),
  );
  assert.equal(review.counts.article_saved, 1);
  assert.equal(review.counts.article_read, 0);
  assert.ok(review.items[0].excerpt.includes("HTTP full tail private source"));
  assert.equal(review.metrics_version, "confirmed-facts-v2");
  await runtime.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  const exact = await call(
    "review/source",
    "GET",
    undefined,
    undefined,
    undefined,
    { kind: "article", id: article.id, version: article.content_version },
  );
  assert.equal(
    check(schemas.LightTickReviewSourceEnvelopeSchema, exact).text,
    body,
  );
  check(schemas.LightTickReviewSnapshotEnvelopeSchema, await call("review"));
  assert.equal(
    check(
      schemas.LightTickReadingArticleEnvelopeSchema,
      await call("reading/articles/" + article.id),
    ).personal.read,
    false,
  );
});
