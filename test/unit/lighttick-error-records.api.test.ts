import { test } from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("error records HTTP contracts, core read/write, owner/auth isolation, receipts and aggregate filters", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "errors-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true });
  app.services.lighttickRuntime!.scopePolicy.current = async () => "core";
  const call = (
    method: string,
    path: string,
    body?: unknown,
    key = "errors-http-key",
    user = "user_alice",
    query = {},
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/error-records" + path,
      body,
      query,
      headers: {
        "x-app-id": "lighttick",
        "idempotency-key": key,
        ...(user
          ? {
              authorization:
                "Bearer " +
                app.services.tokenService.issueAccessToken(user, "lighttick"),
            }
          : {}),
      },
    });
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (name: string, body: unknown) => {
    const validate = ajv.compile(
      (schemas as any)["LightTickError" + name + "EnvelopeSchema"],
    );
    assert.equal(
      validate(JSON.parse(JSON.stringify(body))),
      true,
      JSON.stringify(validate.errors),
    );
  };
  const catalog = await call("GET", "/catalog");
  assert.equal(catalog.statusCode, 200);
  check("Catalog", catalog.body);
  assert.equal(catalog.headers["Cache-Control"], "no-store");
  const body = {
    base_version: 0,
    date: catalog.body.data.business_date,
    module_id: "general",
    category_id: "builtin-bias",
    description: "HTTP error",
    severity: 2,
    context: "Context",
    improvement_action: "Review evidence",
    is_repeat: false,
    related_error_id: null,
  };
  const first = await call("PUT", "/error-http-first", body);
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  check("Record", first.body);
  const second = await call(
    "PUT",
    "/error-http-second",
    { ...body, is_repeat: true, related_error_id: first.body.data.id },
    "errors-http-second",
  );
  assert.equal(second.statusCode, 200);
  check("Detail", (await call("GET", "/error-http-second")).body);
  check("Page", (await call("GET", "")).body);
  check("Receipt", (await call("GET", "/requests/errors-http-key")).body);
  assert.equal(
    (await call("GET", "/error-http-first", undefined, undefined, "user_bob"))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/requests/errors-http-key",
        undefined,
        undefined,
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("GET", "", undefined, undefined, "")).statusCode,
    401,
  );
  assert.equal(
    (await call("PUT", "/error-http-first", body, "stale-http-error"))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await call("GET", "", undefined, undefined, "user_alice", {
        date_from: "2026-02-30",
      })
    ).statusCode,
    422,
  );
  const lookup = await call(
    "GET",
    "/lookup",
    undefined,
    "lookup-read-key",
    "user_alice",
    { q: "HTTP" },
  );
  assert.equal(lookup.statusCode, 200);
  check("Lookup", lookup.body);
  const type = await call(
    "POST",
    "/categories",
    { name: "HTTP type", description: "" },
    "http-create-type",
  );
  check("Category", type.body);
  const deleted = await call(
    "DELETE",
    "/categories/" + type.body.data.id,
    { base_version: 1 },
    "http-delete-type",
  );
  check("DeletedCategory", deleted.body);
});
