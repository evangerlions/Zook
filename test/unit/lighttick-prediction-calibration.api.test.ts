import { test } from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import {
  FormRecordsService,
  emptyFormRecords,
} from "../../src/modules/lighttick/form-records/form-records.service.ts";
import {
  LightTickPredictionCalibrationEnvelopeSchema,
  LightTickPredictionSourceEnvelopeSchema,
} from "../../src/generated/openapi/public-contracts.generated.ts";
test("calibration HTTP is owner scoped, read only in core, validates schemas and refuses stale sources", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "calibration-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    repo = app.services.lighttickRuntime!.repository,
    forms = new FormRecordsService(repo),
    owner = { appId: "lighttick" as const, userId: "user_alice" };
  await forms.save(
    owner,
    {
      base_revision: 0,
      data: {
        ...emptyFormRecords(),
        predictions: [
          {
            date: "2026-11-15",
            statement: "sample",
            probability: 100,
            result: "incorrect",
          },
        ],
      },
    },
    "calibration-original",
  );
  app.services.lighttickRuntime!.scopePolicy.current = async () => "core";
  const call = (suffix = "", query = {}, user = "user_alice", method = "GET") =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/form-records/prediction-calibration" + suffix,
      query,
      headers: {
        authorization: user
          ? "Bearer " +
            app.services.tokenService.issueAccessToken(user, "lighttick")
          : "",
        "x-app-id": "lighttick",
      },
    });
  const result = await call(),
    ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  assert.equal(result.statusCode, 200);
  assert.equal(
    ajv.compile(LightTickPredictionCalibrationEnvelopeSchema)(result.body),
    true,
  );
  assert.equal(result.body.data.brier_score, 1);
  assert.equal(result.headers["Cache-Control"], "no-store");
  const source = await call("/source", { revision: "1", index: "0" });
  assert.equal(source.statusCode, 200);
  assert.equal(
    ajv.compile(LightTickPredictionSourceEnvelopeSchema)(source.body),
    true,
  );
  assert.equal((await call("", {}, "user_bob")).body.data.total, 0);
  assert.equal((await call("", {}, "")).statusCode, 401);
  assert.equal((await call("", { threshold: "101" })).statusCode, 422);
  assert.equal(
    (await call("/source", { revision: "0", index: "0" })).statusCode,
    409,
  );
  assert.equal((await call("", {}, "user_alice", "POST")).statusCode, 503);
  assert.equal((await forms.read(owner)).revision, 1);
  assert.equal(
    (await forms.read({ ...owner, userId: "user_bob" })).revision,
    0,
  );
});
