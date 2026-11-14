import test from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as contracts from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { FocusService } from "../../src/modules/lighttick/focus/focus.service.ts";
test("focus API: core access, standard contracts, auth, CAS, independent rest records and guest denial", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "focus-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const config = seed.appConfigs.find(
    (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
  )!;
  const cfg = JSON.parse(config.configValue);
  config.configValue = JSON.stringify({
    ...cfg,
    settings: { ...cfg.settings, runtimeScope: "core" },
  });
  const repo = new InMemoryLightTickRepository(),
    app = await createApplication({
      seed,
      lighttickEnabled: true,
      lighttickRepository: repo,
    });
  let now = Date.parse("2026-11-14T10:00:00Z");
  app.services.lighttickRuntime!.focus = new FocusService(
    repo,
    () => new Date(now),
  );
  const call = (
    method: string,
    path: string,
    body?: unknown,
    user = "user_alice",
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/focus/" + path,
      body,
      headers: {
        "x-app-id": "lighttick",
        ...(user
          ? {
              authorization:
                "Bearer " +
                app.services.tokenService.issueAccessToken(user, "lighttick"),
            }
          : {}),
      },
    } as any);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (name: string, body: unknown) => {
    const validator = ajv.compile(
      (contracts as any)["LightTickFocus" + name + "EnvelopeSchema"],
    );
    assert.equal(
      validator(JSON.parse(JSON.stringify(body))),
      true,
      JSON.stringify(validator.errors),
    );
  };
  assert.equal((await call("GET", "current", undefined, "")).statusCode, 401);
  const current = await call("GET", "current");
  check("Receipt", current.body);
  assert.equal(current.headers?.["Cache-Control"], "no-store");
  assert.equal(current.body.data.session, null);
  const created = await call("POST", "sessions", {
    request_key: "focus-api-start",
    kind: "focus",
    title: "Write",
    planned_seconds: 60,
  });
  assert.equal(created.statusCode, 201);
  check("Receipt", created.body);
  const id = created.body.data.session.id;
  assert.equal(
    (await call("GET", "sessions/" + id, undefined, "user_bob")).statusCode,
    404,
  );
  assert.equal(
    (
      await call("POST", "sessions/" + id + "/commands", {
        request_key: "focus-api-stale",
        base_version: 99,
        action: "pause",
      })
    ).statusCode,
    409,
  );
  now += 60000;
  const saved = await call("POST", "sessions/" + id + "/commands", {
    request_key: "focus-api-finish",
    base_version: 1,
    action: "finish",
    actual_seconds: 60,
    notes: "Saved",
  });
  check("Receipt", saved.body);
  assert.equal(saved.body.data.session.status, "saved");
  const page = await call("GET", "sessions");
  check("Page", page.body);
  assert.equal(page.body.data.total, 1);
  const receipt = await call("GET", "requests/focus-api-finish");
  check("Receipt", receipt.body);
  assert.equal(receipt.body.data.session.id, id);
  app.services.lighttickRuntime!.guestIdentity = {
    getActive: async () => ({ userId: "user_alice" }),
  } as any;
  assert.equal((await call("GET", "current")).statusCode, 403);
});
