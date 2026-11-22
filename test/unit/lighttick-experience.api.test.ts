import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("canonical experience HTTP schemas, exact writes, complete export and core history/recovery agree", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "experience-http-member",
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
    key = "experience-http-original",
    query?: Record<string, string>,
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/experience" + path,
      body,
      headers: { ...headers, "idempotency-key": key },
      query,
    });
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (name: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const valid = ajv.compile(
      (schemas as any)["LightTickExperience" + name + "EnvelopeSchema"],
    );
    assert.ok(valid(r.body), JSON.stringify(valid.errors));
    return r.body.data;
  };
  assert.equal(
    check("Setup", await call("/setup")).personal_projects_preloaded,
    false,
  );
  check("Categories", await call("/categories"));
  assert.equal(check("Page", await call("/error-types")).items.length, 8);
  const body = {
    base_revision: 0,
    classification_revision: 1,
    data: {
      date: "2026-11-12",
      module_id: "renzhi",
      concept: "Actual concept, no fabricated learning project",
      scenario: "Independent source scenario",
      effectiveness: 0,
    },
  };
  const row = check(
    "Command",
    await call("/applications/application-http-original", "PUT", body),
  );
  check("Object", await call("/applications/" + row.id));
  check("Page", await call("/applications"));
  check("History", await call("/applications/" + row.id + "/history"));
  check(
    "Statistics",
    await call("/applications/stats", "GET", undefined, undefined, {
      period: "2",
      end: "2026-11-12",
    }),
  );
  check("Concepts", await call("/concepts"));
  check("Repeated", await call("/repeated"));
  const errorData = {
    date: null,
    module_id: null,
    error_type: "Free form type",
    type_id: null,
    description: "Unknown facts remain unknown",
    severity: 0,
    context: null,
    improvement_action: null,
    is_repeat: null,
    related_error_id: null,
  };
  check(
    "Command",
    await call(
      "/errors/error-http-original",
      "PUT",
      {
        base_revision: 0,
        classification_revision: null,
        type_revision: null,
        data: errorData,
      },
      "experience-http-error",
    ),
  );
  check("Statistics", await call("/errors/stats"));
  const type = check(
    "Command",
    await call(
      "/error-types/errtype-http-original",
      "PUT",
      {
        base_revision: 0,
        data: {
          name: "Personal type",
          description: "Explicit personal classification",
        },
      },
      "experience-http-type",
    ),
  );
  assert.equal(type.revision, 1);
  for (const section of ["objects", "versions", "tombstones", "receipts"])
    check(
      "ExportPage",
      await call("/export", "GET", undefined, undefined, { section }),
    );
  const preview = check(
    "DeletionPreview",
    await call("/applications/" + row.id + "/deletion-preview"),
  );
  check(
    "Command",
    await call(
      "/applications/" + row.id + "/delete",
      "POST",
      { base_revision: row.revision, scope_digest: preview.scope_digest },
      "experience-http-delete",
    ),
  );
  assert.equal(
    (await call("/receipts/experience-http-original")).statusCode,
    410,
  );
  check("Receipt", await call("/receipts/experience-http-delete"));
  await app.services.appConfigService.setValue(
    "lighttick",
    "admin.delivery_config",
    JSON.stringify({ enabled: true, settings: { runtimeScope: "core" } }),
  );
  check("Receipt", await call("/receipts/experience-http-error"));
  check("Object", await call("/errors/error-http-original"));
  check("History", await call("/errors/error-http-original/history"));
  check(
    "ExportPage",
    await call("/export", "GET", undefined, undefined, { section: "receipts" }),
  );
  assert.equal(
    (
      await call(
        "/errors/error-http-original",
        "PUT",
        {
          base_revision: 1,
          classification_revision: null,
          type_revision: null,
          data: errorData,
        },
        "experience-http-core-write",
      )
    ).statusCode,
    503,
  );
  assert.equal(
    (
      await call(
        "/errors/error-http-original/delete",
        "POST",
        { base_revision: 1, scope_digest: preview.scope_digest },
        "experience-http-core-delete",
      )
    ).statusCode,
    503,
  );
  assert.equal(
    check("Receipt", await call("/receipts/experience-http-core-write")).found,
    false,
  );
  const unauth = await app.app.handle({
    method: "GET",
    path: "/api/v1/lighttick/experience/errors",
    headers: { "x-app-id": "lighttick" },
  });
  assert.equal(unauth.statusCode, 401);
});
