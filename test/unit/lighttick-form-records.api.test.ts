import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { emptyFormRecords } from "../../src/modules/lighttick/form-records/form-records.service.ts";
import {
  LightTickFormEnvelopeSchema,
  LightTickFormExportEnvelopeSchema,
} from "../../src/generated/openapi/public-contracts.generated.ts";
test("form HTTP validates strict contracts, owner boundary and independent export/clear scope", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "forms-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    ajv = new Ajv({ strict: false });
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "forms-http-original",
    user = "user_alice",
  ) =>
    app.app.handle({
      path: "/api/v1/lighttick/" + path,
      method,
      body,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  const saved = await call("form-records", "PUT", {
    base_revision: 0,
    data: emptyFormRecords(),
  });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(ajv.compile(LightTickFormEnvelopeSchema)(saved.body), true);
  assert.equal(saved.headers?.["Cache-Control"], "no-store");
  const exported = await call("form-records/export");
  assert.equal(
    ajv.compile(LightTickFormExportEnvelopeSchema)(exported.body),
    true,
  );
  const full = JSON.parse((await call("review/export")).body.data.content);
  assert.equal(full.form_records.revision, 1);
  assert.equal(
    (await call("form-records", "GET", undefined, "forms-other", "user_bob"))
      .body.data.revision,
    0,
  );
  assert.equal(
    (
      await call(
        "form-records",
        "PUT",
        { base_revision: 0, data: emptyFormRecords() },
        "forms-http-stale",
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "form-records/clear",
        "POST",
        { base_revision: 1, all_data: true },
        "forms-http-invalid",
      )
    ).statusCode,
    422,
  );
  const cleared = await call(
    "form-records/clear",
    "POST",
    { base_revision: 1 },
    "forms-http-clear",
  );
  assert.equal(cleared.statusCode, 200);
  assert.equal(
    JSON.stringify((await call("sync/pull")).body).includes("form_records"),
    false,
  );
  assert.equal((await call("form-records", "DELETE")).statusCode, 405);
});
