import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("canonical reading metadata, structured feedback and source edition contracts retain old private components", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "reading-semantics-member",
    appId: "lighttick",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: new Date().toISOString(),
  });
  const runtime = await createApplication({ seed, lighttickEnabled: true });
  const headers = {
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
    key = "semantics-http-original",
  ) => {
    const u = new URL("http://local/api/v1/lighttick/reading" + path);
    return runtime.app.handle({
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      method,
      body,
      headers: { ...headers, "idempotency-key": key },
    });
  };
  const check = (name: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const validate = ajv.compile(
      (schemas as any)["LightTickReading" + name + "Schema"],
    );
    assert.equal(validate(r.body), true, JSON.stringify(validate.errors));
    return r.body.data;
  };
  const row = check(
    "ArticleEnvelope",
    await call(
      "/articles/article-semantics",
      "PUT",
      {
        base_revision: 0,
        content: {
          title: "Original".repeat(60),
          body: "Original content",
          source_url: "https://example.com/article",
          language: "en",
          published_at: null,
          published_date: "2020-02-29",
          translated_title: "译名",
          publisher: "Publisher",
          topics: ["认知"],
          access: "Only feed checked",
          category: "classic",
          recommendation_reason: "Original reason",
        },
      },
      "semantics-import-original",
    ),
  );
  assert.equal(row.provenance.kind, "manual_import");
  const feedback = check(
    "ArticleEnvelope",
    await call(
      "/articles/" + row.id + "/feedback",
      "POST",
      {
        base_revision: 1,
        content_version: row.content_version,
        base_feedback_revision: 0,
        feedback: {
          value: "insightful",
          difficulty: "hard",
          takeaway: "Exact takeaway",
          question: "Question",
          action: "Action idea",
          tags: ["Context"],
        },
        mark_read: false,
      },
      "semantics-feedback-original",
    ),
  );
  assert.equal(feedback.personal.read, false);
  assert.equal(feedback.personal.structured_feedback.version, 1);
  check("EditionsEnvelope", await call("/articles/" + row.id + "/editions"));
  check("ExportEnvelope", await call("/export"));
  const work = check(
    "WorkEnvelope",
    await call(
      "/work",
      "POST",
      {
        kind: "fetch_full",
        article_id: row.id,
        content_version: row.content_version,
      },
      "semantics-fulltext-original",
    ),
  );
  assert.equal(work.kind, "fetch_full");
  assert.equal(work.scope.content_version, row.content_version);
  await runtime.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  check("EditionsEnvelope", await call("/articles/" + row.id + "/editions"));
  check("ArticleEnvelope", await call("/receipts/semantics-feedback-original"));
  assert.equal(
    (
      await call(
        "/articles/" + row.id + "/feedback",
        "POST",
        {
          base_revision: 2,
          content_version: row.content_version,
          base_feedback_revision: 1,
          feedback: {
            value: "",
            difficulty: "",
            takeaway: "",
            question: "",
            action: "",
            tags: [],
          },
          mark_read: true,
        },
        "semantics-core-refused",
      )
    ).statusCode,
    503,
  );
});
