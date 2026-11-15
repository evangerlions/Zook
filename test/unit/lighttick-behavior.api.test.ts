import { test } from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
test("behavior HTTP contracts, owner and core boundaries, topic receipts and immutable snapshot", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "behavior-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const repo = Object.assign(new InMemoryLightTickRepository(), {
      listReadingArticles: async () => [],
      listReadingStates: async () => [],
      listReadingFeedback: async () => [],
    }),
    app = await createApplication({
      seed,
      lighttickEnabled: true,
      lighttickRepository: repo,
    });
  app.services.lighttickRuntime!.scopePolicy.current = async () => "core";
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "behavior-api-key",
    user = "user_alice",
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/" + path,
      body,
      headers: {
        authorization: user
          ? "Bearer " +
            app.services.tokenService.issueAccessToken(user, "lighttick")
          : "",
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (schema: string, b: unknown) => {
    const validator = ajv.compile((schemas as any)[schema + "Schema"]);
    assert.equal(
      validator(JSON.parse(JSON.stringify(b))),
      true,
      JSON.stringify(validator.errors),
    );
  };
  const catalog = await call("behavior-applications/catalog");
  assert.equal(catalog.statusCode, 200);
  check("LightTickBehaviorCatalogEnvelope", catalog.body);
  const input = {
      base_version: 0,
      date: catalog.body.data.business_date,
      module_id: "general",
      concept: "核对假设",
      scenario: "PRIVATE_BODY_NOT_SEND",
      effectiveness: 4,
    },
    saved = await call("behavior-applications/application-http", "PUT", input);
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.headers["Cache-Control"], "no-store");
  check("LightTickBehaviorRowEnvelope", saved.body);
  check(
    "LightTickBehaviorPageEnvelope",
    (await call("behavior-applications")).body,
  );
  check(
    "LightTickBehaviorConceptEnvelope",
    (await call("behavior-applications/concepts")).body,
  );
  assert.equal(
    (
      await call(
        "behavior-applications/application-http",
        "GET",
        undefined,
        undefined,
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("behavior-applications", "GET", undefined, undefined, ""))
      .statusCode,
    401,
  );
  const report = await call("behavior-reports", "POST", {
    request_key: "behavior-http-report",
    mode: "facts",
    period_days: 7,
  });
  assert.equal(report.statusCode, 202, JSON.stringify(report.body));
  check("LightTickAccountReportDetailEnvelope", report.body);
  assert.equal(report.body.data.topic, "behavior");
  assert.ok(!JSON.stringify(report.body).includes("PRIVATE_BODY"));
  assert.equal(
    (await call("account-reports/" + report.body.data.id)).statusCode,
    404,
  );
  assert.equal(
    (await call("behavior-reports/requests/by-key/behavior-http-report")).body
      .data.id,
    report.body.data.id,
  );
  assert.equal(
    (
      await call("behavior-reports", "POST", {
        request_key: "behavior-http-ai",
        mode: "ai",
        period_days: 7,
      })
    ).statusCode,
    503,
  );
  assert.equal(
    (
      await call("behavior-reports/" + report.body.data.id, "DELETE", {
        base_version: 1,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await call("behavior-reports/requests/by-key/behavior-http-report")).body
      .data.status,
    "deleted",
  );
});
