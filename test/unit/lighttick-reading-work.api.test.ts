import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("reading source/work HTTP responses use canonical contracts, owner authorization and core cancellation/receipt semantics", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "reading-work-member",
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
      runtime.services.tokenService.issueAccessToken("user_alice", "lighttick"),
    "x-app-id": "lighttick",
  };
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "reading-http-original",
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
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (name: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const validate = ajv.compile(
      (schemas as any)["LightTickReading" + name + "EnvelopeSchema"],
    );
    assert.equal(validate(r.body), true, JSON.stringify(validate.errors));
    return r.body.data;
  };
  const source = check(
    "Source",
    await call(
      "/sources/source-api",
      "PUT",
      {
        base_revision: 0,
        title: "My source",
        url: "https://example.com/feed",
        format: "rss",
        archived: false,
      },
      "reading-source-original",
    ),
  );
  check("Source", await call("/sources/source-api"));
  check("SourcePage", await call("/sources"));
  check("SourcePage", await call("/sources/source-api/history"));
  const created = check(
    "Work",
    await call("/work", "POST", {
      kind: "collect_source",
      source_id: source.id,
      base_revision: source.revision,
    }),
  );
  check("Work", await call("/work/" + created.id));
  check("WorkPage", await call("/work"));
  const receipt = check(
    "WorkReceipt",
    await call("/work-receipts/reading-http-original"),
  );
  assert.deepEqual(receipt.result, created);
  check("Export", await call("/export"));
  await runtime.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  check(
    "Work",
    await call(
      "/work/" + created.id + "/cancel",
      "POST",
      { base_revision: created.revision },
      "reading-http-cancel",
    ),
  );
  check("WorkReceipt", await call("/work-receipts/reading-http-cancel"));
  assert.equal(
    (
      await call(
        "/work",
        "POST",
        { kind: "collect_url", url: "https://example.com/a", title: "Other" },
        "reading-http-core",
      )
    ).statusCode,
    503,
  );
  assert.equal(
    (
      await call("/work", "POST", {
        kind: "collect_source",
        source_id: source.id,
        base_revision: source.revision,
      })
    ).statusCode,
    503,
  );
  const replay = check(
    "WorkReceipt",
    await call("/work-receipts/reading-http-original"),
  );
  assert.equal(
    replay.result.status,
    "queued",
    "GET original receipt is historical, not current work state",
  );
});
