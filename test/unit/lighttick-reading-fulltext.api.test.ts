import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import { readingPdfFixture } from "../support/reading-pdf-fixture.ts";
test("HTTP PDF capture and explicit import satisfy the fixed generated contract; 500000-character imports retain original identity", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "pdf-http-member",
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
    key = "pdf-http-original",
  ) =>
    runtime.app.handle({
      path: "/api/v1/lighttick/reading" + path,
      method,
      body,
      headers: { ...headers, "idempotency-key": key },
    });
  const checked = (name: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const validate = ajv.compile(
      (schemas as any)["LightTickReading" + name + "Schema"],
    );
    assert.ok(validate(r.body), JSON.stringify(validate.errors));
    return r.body.data;
  };
  const created = checked(
      "WorkEnvelope",
      await call(
        "/work",
        "POST",
        {
          kind: "collect_url",
          title: "PDF selected source",
          url: "https://example.com/selected.pdf",
        },
        "pdf-http-create",
      ),
    ),
    work = runtime.services.lighttickRuntime.readingWork!;
  const runner = new ReadingWorkRunner(
    work,
    {
      complete: async () => {
        throw Error("PDF cannot call a model");
      },
    } as any,
    async () => ({
      body: readingPdfFixture().toString("base64"),
      encoding: "base64",
      content_type: "application/pdf",
    }),
  );
  await runner.execute(
    { appId: "lighttick", userId: "user_alice" },
    created.id,
  );
  const done = checked("WorkEnvelope", await call("/work/" + created.id));
  assert.equal(done.status, "succeeded");
  assert.equal(done.output.document.encoding, "base64");
  const imported = checked(
      "WorkAdoptResultEnvelope",
      await call(
        "/work/" + created.id + "/adopt",
        "POST",
        {
          base_revision: done.revision,
          output_digest: done.output_digest,
          index: 0,
          base_article_revision: null,
        },
        "pdf-http-adopt",
      ),
    ),
    article = checked(
      "ArticleEnvelope",
      await call("/articles/" + imported.article_id),
    );
  assert.ok(article.content.body.includes("Synthetic PDF text"));
  assert.equal(article.personal.read, false);
  const content = {
      title: "Maximum original",
      body: "x".repeat(500000),
      source_url: null,
      language: "en",
      published_at: null,
    },
    request = { base_revision: 0, content },
    first = checked(
      "ArticleEnvelope",
      await call(
        "/articles/article-long-original",
        "PUT",
        request,
        "long-http-original",
      ),
    );
  assert.equal(first.content.body.length, 500000);
  assert.deepEqual(
    checked(
      "ArticleEnvelope",
      await call(
        "/articles/article-long-original",
        "PUT",
        request,
        "long-http-original",
      ),
    ),
    first,
  );
  assert.equal(
    (
      await call(
        "/articles/article-too-long",
        "PUT",
        { base_revision: 0, content: { ...content, body: content.body + "x" } },
        "long-http-too-large",
      )
    ).statusCode,
    422,
  );
});
