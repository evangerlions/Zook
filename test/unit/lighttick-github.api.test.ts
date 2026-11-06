import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { GitHubService } from "../../src/modules/lighttick/github/github.service.ts";
import { GitHubClient } from "../../src/modules/lighttick/github/github.client.ts";
import { GitHubTestRunner } from "../../src/modules/lighttick/github/github-test.runner.ts";
test("GitHub HTTP owner/auth boundaries, schema responses, receipts and worker are connected", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "github-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    runtime = app.services.lighttickRuntime!,
    old = runtime.github!,
    ajv = new Ajv({ strict: false });
  addFormats(ajv);
  runtime.github = new GitHubService(
    old.repo,
    old.crypto,
    old.keyId,
    old.queue,
    new GitHubClient(
      async () =>
        new Response(
          JSON.stringify({
            ref: "refs/heads/main",
            object: { type: "commit", sha: "a".repeat(40) },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  const call = (
    suffix = "",
    method = "GET",
    body?: unknown,
    key = "github-original-request",
    user = "user_alice",
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/account/github" + suffix,
      body,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  function check(name: string, r: any) {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const valid = ajv.compile(
      (schemas as any)["LightTickGitHub" + name + "EnvelopeSchema"],
    );
    assert.ok(valid(r.body), JSON.stringify(valid.errors));
    assert.equal(r.headers["Cache-Control"], "no-store");
    return r.body.data;
  }
  assert.equal(check("Settings", await call()).revision, 0);
  const b = {
    base_revision: 0,
    mode: "custom",
    repository: "fixture/content",
    branch: "main",
    token: "SYNTHETIC_GITHUB_TOKEN",
  };
  assert.equal(check("Settings", await call("", "PUT", b)).revision, 1);
  assert.equal(
    check("Settings", await call("/receipts/github-original-request")).revision,
    1,
  );
  assert.equal(
    (
      await call(
        "/receipts/github-original-request",
        "GET",
        undefined,
        "unused-original",
        "user_bob",
      )
    ).statusCode,
    404,
  );
  const work = check(
    "Test",
    await call(
      "/tests",
      "POST",
      { settings_revision: 1 },
      "github-test-original",
    ),
  );
  await new GitHubTestRunner(runtime.github).execute(
    { appId: "lighttick", userId: "user_alice" },
    work.id,
  );
  assert.equal(
    check("Test", await call("/test-receipts/github-test-original")).status,
    "succeeded",
  );
  assert.equal(
    (
      await call(
        "/tests/" + work.id,
        "GET",
        undefined,
        "unused-original",
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("", "PUT", { ...b, token: "DIFFERENT" })).statusCode,
    409,
  );
  const anon = await app.app.handle({
    method: "GET",
    path: "/api/v1/lighttick/account/github",
    headers: { "x-app-id": "lighttick" },
  });
  assert.equal(anon.statusCode, 401);
  assert.equal(
    JSON.stringify(check("Settings", await call())).includes(b.token),
    false,
  );
});
