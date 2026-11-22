import test from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as contracts from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ReadingWorkflowService } from "../../src/modules/lighttick/reading/reading-workflow.service.ts";
test("reading API: core scope, contract responses, auth, private feeds, stale source writes and preserved failure history", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "reading-" + userId,
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
  app.services.lighttickRuntime!.readingWorkflow = new ReadingWorkflowService(
    repo,
    async () => {
      throw Error("upstream secret");
    },
  );
  const call = (
    method: string,
    path: string,
    body?: unknown,
    user = "user_alice",
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/reading/" + path,
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
    const validate = ajv.compile(
      (contracts as any)["LightTickReadingWorkflow" + name + "Schema"],
    );
    assert.equal(
      validate(JSON.parse(JSON.stringify(body))),
      true,
      JSON.stringify(validate.errors),
    );
  };
  assert.equal((await call("GET", "feed-sources", undefined, "")).statusCode, 401);
  const setup = await call("GET", "feed-sources");
  check("SetupEnvelope", setup.body);
  assert.equal(setup.statusCode, 200);
  const privateFeed = await call("POST", "feed-sources", {
    name: "private",
    url: "https://127.0.0.1/feed",
    language: "en",
    topics: [],
  });
  assert.equal(privateFeed.statusCode, 400);
  const created = await call("POST", "feed-sources", {
    name: "Example",
    url: "https://example.com/rss",
    language: "en",
    topics: ["growth"],
  });
  assert.equal(created.statusCode, 201);
  check("SourceEnvelope", created.body);
  const id = (created.body as any).data.id;
  assert.equal(
    (await call("PATCH", "feed-sources/" + id, { base_version: 99, enabled: false }))
      .statusCode,
    409,
  );
  const collection = await call("POST", "collections", {
    request_key: "reading-api-request",
    source_ids: [id],
  });
  assert.equal(collection.statusCode, 200);
  check("CollectionEnvelope", collection.body);
  assert.equal((collection.body as any).data.status, "failed");
  const history = await call("GET", "collections");
  check("HistoryEnvelope", history.body);
  assert.equal((history.body as any).data.items.length, 1);
  assert.equal(
    (await call("GET", "collections", undefined, "user_bob")).body.data.items
      .length,
    0,
  );
  const tasks = await call("GET", "tasks");
  check("TasksEnvelope", tasks.body);
  assert.equal(tasks.statusCode, 200);
  app.services.lighttickRuntime!.guestIdentity = {
    getActive: async () => ({ userId: "user_alice" }),
  } as any;
  assert.equal((await call("GET", "feed-sources")).statusCode, 403);
});
