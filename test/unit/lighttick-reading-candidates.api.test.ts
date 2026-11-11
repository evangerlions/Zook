import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
test("HTTP metadata-only candidates and explicit source retrieval obey generated contracts, original request identity and core recovery", async () => {
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
  const source = check(
    "SourceEnvelope",
    await call(
      "/sources/source-candidate-http",
      "PUT",
      {
        base_revision: 0,
        title: "Source",
        url: "https://example.com/feed",
        format: "rss",
        archived: false,
        language: "en",
        topics: ["认知"],
        domains: ["example.com"],
      },
      "candidate-http-source",
    ),
  );
  const job = check(
      "WorkEnvelope",
      await call(
        "/work",
        "POST",
        { kind: "collect_source", source_id: source.id, base_revision: 1 },
        "candidate-http-collect",
      ),
    ),
    work = runtime.services.lighttickRuntime.readingWork!,
    runner = new ReadingWorkRunner(
      work,
      {
        complete: async () => {
          throw Error("No model");
        },
      } as any,
      async (url) =>
        url.endsWith("/feed")
          ? {
              body: "<rss><channel><item><title>Original title</title><link>https://example.com/article</link><author>Original author</author></item></channel></rss>",
              content_type: "application/rss+xml",
            }
          : {
              body:
                "<p>" +
                "The complete body retains original source evidence and uncertainty. ".repeat(
                  3,
                ) +
                "</p>",
              content_type: "text/html",
            },
    );
  await runner.execute({ appId: "lighttick", userId: "user_alice" }, job.id);
  const ready = check("WorkEnvelope", await call("/work/" + job.id));
  assert.equal(ready.output.entries.length, 0);
  assert.equal(ready.output.candidates.length, 1);
  assert.ok(ready.output.warnings.length);
  check("ExportEnvelope", await call("/export"));
  const c = ready.output.candidates[0],
    request = {
      kind: "collect_url",
      title: c.content.title,
      url: c.content.source_url,
      candidate: {
        work_id: ready.id,
        output_digest: ready.output_digest,
        candidate_id: c.id,
      },
    },
    created = check(
      "WorkEnvelope",
      await call("/work", "POST", request, "candidate-http-fetch"),
    );
  assert.equal(created.scope.candidate_work_id, ready.id);
  assert.equal(created.scope.candidate_id, c.id);
  assert.deepEqual(
    check(
      "WorkEnvelope",
      await call("/work", "POST", request, "candidate-http-fetch"),
    ),
    created,
  );
  await runner.execute(
    { appId: "lighttick", userId: "user_alice" },
    created.id,
  );
  const completed = check("WorkEnvelope", await call("/work/" + created.id));
  assert.equal(completed.output.entries[0].author, "Original author");
  assert.deepEqual(completed.output.entries[0].topics, ["认知"]);
  await runtime.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  check("WorkEnvelope", await call("/work/" + ready.id));
  check(
    "WorkReceiptEnvelope",
    await call("/work-receipts/candidate-http-fetch"),
  );
  assert.equal(
    (await call("/work", "POST", request, "candidate-http-fetch")).statusCode,
    503,
  );
});
