import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
test("canonical HTTP import review and decisions share fixed schemas, preserve exact original receipts and allow readonly work previews in core", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "reading-import-member",
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
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "reading-import-http-key",
    query?: Record<string, string>,
  ) =>
    app.app.handle({
      path: "/api/v1/lighttick/reading" + path,
      method,
      body,
      query,
      headers: { ...headers, "idempotency-key": key },
    });
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (name: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const valid = ajv.compile(
      (schemas as any)["LightTickReading" + name + "EnvelopeSchema"],
    );
    assert.ok(valid(r.body), JSON.stringify(valid.errors));
    return r.body.data as any;
  };
  const content = {
    title: "HTTP source",
    body: "Original HTTP source 🙂",
    language: "en",
    source_url: "https://reading.example.test/import?id=1#local",
    published_at: null,
  };
  const first = check(
    "ImportScope",
    await call("/import-preview", "POST", { content }),
  );
  assert.equal(first.candidates.length, 0);
  const body = {
    base_revision: 0,
    content,
    import_decision: {
      scope_digest: first.digest,
      mode: "independent",
      article_id: null,
    },
  };
  const article = check(
    "Article",
    await call(
      "/articles/article-import-http-one",
      "PUT",
      body,
      "reading-import-http-original",
    ),
  );
  const same = check(
    "ImportScope",
    await call("/import-preview", "POST", { content }),
  );
  assert.equal(same.candidates[0].id, article.id);
  assert.equal(
    (
      await call(
        "/articles/article-import-http-two",
        "PUT",
        { base_revision: 0, content },
        "reading-import-http-implicit",
      )
    ).statusCode,
    409,
  );
  const copy = {
    ...body,
    import_decision: { ...body.import_decision, scope_digest: same.digest },
  };
  check(
    "Article",
    await call(
      "/articles/article-import-http-two",
      "PUT",
      copy,
      "reading-import-http-copy",
    ),
  );
  assert.equal(
    (
      await call(
        "/articles/article-import-http-three",
        "PUT",
        copy,
        "reading-import-http-stale",
      )
    ).statusCode,
    409,
  );
  const work = check(
    "Work",
    await call(
      "/work",
      "POST",
      {
        kind: "collect_url",
        url: "https://reading.example.test/another",
        title: "Work source",
      },
      "reading-import-http-work",
    ),
  );
  const runner = new ReadingWorkRunner(
    app.services.lighttickRuntime!.readingWork!,
    {} as any,
    async () => ({
      body: "<p>Distinct HTTP collected original.</p>",
      content_type: "text/html",
    }),
  );
  await runner.execute({ appId: "lighttick", userId: "user_alice" }, work.id);
  const preview = check(
    "ImportScope",
    await call(
      "/work/" + work.id + "/import-preview",
      "GET",
      undefined,
      undefined,
      { index: "0" },
    ),
  );
  assert.equal(preview.candidates.length, 0);
  await app.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  check(
    "ImportScope",
    await call(
      "/work/" + work.id + "/import-preview",
      "GET",
      undefined,
      undefined,
      { index: "0" },
    ),
  );
  assert.equal(
    check("Article", await call("/receipts/reading-import-http-original")).id,
    article.id,
  );
  assert.equal(
    (await call("/import-preview", "POST", { content })).statusCode,
    503,
  );
});
