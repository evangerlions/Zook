import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { PersonalModelDispatcher } from "../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts";
import { PersonalModelTestRunner } from "../../src/modules/lighttick/personal-model/personal-model-test.runner.ts";
test("personal model HTTP is owner-only, secret-free, AJV conformant and connected to existing worker tests", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "model-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    runtime = app.services.lighttickRuntime!,
    o = { appId: "lighttick" as const, userId: "user_alice" },
    ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const call = (
    suffix: string,
    method = "GET",
    body?: unknown,
    key = "original-model-request",
    user = "user_alice",
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/ai/model-settings" + suffix,
      body,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  const check = (n: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const validate = ajv.compile(
      (schemas as any)["LightTickPersonalModel" + n + "EnvelopeSchema"],
    );
    assert.ok(
      validate(JSON.parse(JSON.stringify(r.body))),
      JSON.stringify(validate.errors),
    );
    assert.equal(r.headers["Cache-Control"], "no-store");
    return r.body.data;
  };
  assert.equal(check("Settings", await call("")).revision, 0);
  const body = {
    base_revision: 0,
    mode: "personal",
    base_url: "https://model.example/v1",
    model_name: "owner-model",
    api_key: "SYNTHETIC_PRIVATE_KEY",
  };
  const saved = check("Settings", await call("", "PUT", body));
  assert.equal(saved.configured, true);
  assert.equal(JSON.stringify(saved).includes(body.api_key), false);
  assert.equal(
    check("Settings", await call("/receipts/original-model-request")).revision,
    1,
  );
  assert.equal(
    (
      await call(
        "/receipts/original-model-request",
        "GET",
        undefined,
        "unused-original",
        "user_bob",
      )
    ).statusCode,
    404,
  );
  const d = new PersonalModelDispatcher(
      runtime.personalModel!,
      {
        complete: async () => {
          throw Error("must not fallback");
        },
      },
      (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
          }),
        )) as any,
    ),
    runner = new PersonalModelTestRunner(runtime.personalModel!, d);
  const work = check(
    "Test",
    await call(
      "/tests",
      "POST",
      { settings_revision: 1 },
      "model-test-original",
    ),
  );
  await runner.execute(o, work.id);
  assert.equal(
    check("Test", await call("/tests/" + work.id)).status,
    "succeeded",
  );
  assert.equal(
    check(
      "Test",
      await call(
        "/tests",
        "POST",
        { settings_revision: 1 },
        "model-test-original",
      ),
    ).status,
    "succeeded",
  );
  assert.equal(
    (await call("", "PUT", { ...body, api_key: "different" })).statusCode,
    409,
  );
  check(
    "Settings",
    await call(
      "",
      "PUT",
      {
        base_revision: 1,
        mode: "platform",
        base_url: null,
        model_name: null,
        api_key: null,
      },
      "model-clear-original",
    ),
  );
  assert.equal(check("Settings", await call("", "PUT", body)).revision, 1);
  const draftBody = {
    settings_revision: 0,
    config: {
      base_url: body.base_url,
      model_name: body.model_name,
      api_key: body.api_key,
    },
  };
  const draftTest = check(
    "Test",
    await call("/tests", "POST", draftBody, "draft-test-original", "user_bob"),
  );
  assert.equal(draftTest.target, "draft");
  assert.equal(
    check(
      "Settings",
      await call("", "GET", undefined, "unused-original", "user_bob"),
    ).revision,
    0,
  );
  await runner.execute(
    { appId: "lighttick", userId: "user_bob" },
    draftTest.id,
  );
  assert.equal(
    check(
      "Test",
      await call(
        "/test-receipts/draft-test-original",
        "GET",
        undefined,
        "unused-original",
        "user_bob",
      ),
    ).status,
    "succeeded",
  );
  assert.equal(
    check(
      "Settings",
      await call("", "GET", undefined, "unused-original", "user_bob"),
    ).revision,
    0,
  );
  await app.database.updateAppUserStatus("lighttick", "user_alice", "BLOCKED");
  assert.equal(
    (await call("/receipts/original-model-request")).statusCode,
    403,
  );
});
