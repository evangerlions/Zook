import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/independent-reading/reading-work.runner.ts";
import { syntheticReadingGuide } from "../support/reading-guide-fixture.ts";
test("canonical HTTP reading scopes/evidence/usage/export and original material receipts retain exact independent ranges in core", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "reading-ai-http-member",
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
    },
    o = { appId: "lighttick", userId: "user_alice" } as const;
  const call = (
      path: string,
      method = "GET",
      body?: unknown,
      key = "reading-ai-http-key",
    ) =>
      app.app.handle({
        path: "/api/v1/lighttick/reading" + path,
        method,
        body,
        headers: { ...headers, "idempotency-key": key },
      }),
    ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = (name: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const check = ajv.compile(
      (schemas as any)["LightTickReading" + name + "EnvelopeSchema"],
    );
    assert.equal(check(r.body), true, JSON.stringify(check.errors));
    return r.body.data as any;
  };
  let article = validate(
    "Article",
    await call(
      "/articles/article-ai-http-original",
      "PUT",
      {
        base_revision: 0,
        content: {
          title: "Synthetic HTTP source",
          body: "a🙂中 original argument.\n\nOther paragraph",
          language: "en",
          published_at: null,
          source_url: null,
        },
      },
      "reading-ai-http-import",
    ),
  );
  const input = {
      kind: "guide",
      guide_format: "reading-v2",
      article_id: article.id,
      content_version: article.content_version,
      paragraph_id: null,
      source_range: { start: 1, end: 15 },
    },
    created = validate(
      "Work",
      await call("/work", "POST", input, "reading-ai-http-create"),
    );
  assert.deepEqual(created.scope.source_range, input.source_range);
  assert.equal(created.scope.selected_characters, 14);
  assert.equal(created.scope.prompt_version, "1.1.0");
  const runner = new ReadingWorkRunner(
    app.services.lighttickRuntime!.readingWork!,
    {
      complete: async () => ({
        text: syntheticReadingGuide,
        provider: "synthetic",
        providerModel: "fixture-v1",
        usage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          estimated: true,
        },
      }),
    } as any,
    async () => {
      throw Error("No fetch expected");
    },
  );
  await runner.execute(o, created.id);
  const done = validate("Work", await call("/work/" + created.id));
  assert.equal(done.output.evidence.guide_format, "reading-v2");
  assert.equal(done.model_usage.cost_amount, null);
  validate("WorkPage", await call("/work"));
  validate("Export", await call("/export"));
  const saved = await call(
    "/work/" + created.id + "/adopt",
    "POST",
    {
      base_revision: done.revision,
      output_digest: done.output_digest,
      index: null,
      base_article_revision: article.revision,
      response_view: "summary",
    },
    "reading-ai-http-save",
  );
  validate("WorkAdoptResult", saved);
  article = validate("Article", await call("/articles/" + article.id));
  assert.equal(
    article.materials[0].draft.evidence.prompt_sha256,
    done.output.evidence.prompt_sha256,
  );
  assert.equal(article.materials[0].adopted, null);
  const draft = {
    base_revision: article.revision,
    content_version: article.content_version,
    kind: "guide",
    paragraph_id: null,
    source_range: input.source_range,
    text: "My explicit edited interpretation",
  };
  article = validate(
    "Article",
    await call(
      "/articles/" + article.id + "/draft",
      "POST",
      draft,
      "reading-ai-http-edit",
    ),
  );
  assert.equal(article.materials[0].draft.derived_from.origin, "ai");
  validate("Export", await call("/export"));
  assert.equal(
    (
      await call(
        "/work",
        "POST",
        { ...input, paragraph_id: "p-1" },
        "reading-ai-http-mixed",
      )
    ).statusCode,
    422,
  );
  await app.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  const original = validate(
    "Article",
    await call("/receipts/reading-ai-http-edit"),
  );
  assert.equal(original.materials[0].draft.text, draft.text);
  assert.equal(
    (await call("/work", "POST", input, "reading-ai-http-core")).statusCode,
    503,
  );
});
