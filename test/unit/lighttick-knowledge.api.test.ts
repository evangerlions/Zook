import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
test("knowledge and review HTTP preserve strict contracts, owner scope and cursor recovery", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "knowledge-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "knowledge-http-original",
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
  const check = (name: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const validate = ajv.compile(
      (schemas as any)["LightTick" + name + "EnvelopeSchema"],
    );
    assert.equal(
      validate(JSON.parse(JSON.stringify(r.body))),
      true,
      JSON.stringify(validate.errors),
    );
    return r.body.data;
  };
  const body = {
    base_revision: 0,
    kind: "knowledge",
    title: "Saved reasoning",
    body: "Confirmed synthetic body",
    tags: [],
    sources: [],
  };
  check(
    "KnowledgeEntry",
    await call("knowledge/knowledge-http-fixture", "PUT", body),
  );
  check(
    "KnowledgeHistory",
    await call("knowledge/knowledge-http-fixture/history"),
  );
  const exportData=check('ReviewExport',await call('review/export'));assert.equal(JSON.parse(exportData.content).knowledge.length,1);
  const snapshot = check("ReviewSnapshot", await call("review"));
  assert.equal(snapshot.counts.knowledge, 1);
  assert.equal(snapshot.items[0].excerpt, "Confirmed synthetic body");
  assert.equal(
    (
      await call(
        "knowledge/knowledge-http-fixture",
        "GET",
        undefined,
        "unused",
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call("knowledge/knowledge-http-fixture", "PUT", {
        ...body,
        body: "Changed original body",
      })
    ).statusCode,
    409,
  );
  check(
    "KnowledgeEntry",
    await call(
      "knowledge/knowledge-http-fixture/archive",
      "POST",
      { base_revision: 1 },
      "knowledge-http-archive",
    ),
  );
  assert.equal(check("ReviewSnapshot", await call("review")).total, 0);
  const guest = await call("sync/pull");
  assert.equal(
    JSON.stringify(guest.body).includes("knowledge-http-fixture"),
    false,
    "new resource does not enter old pull",
  );
});
