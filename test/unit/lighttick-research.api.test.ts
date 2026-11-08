import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
test("research HTTP matches OpenAPI, owners and membership, durable original requests, history and archive", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "research-" + userId,
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
    key = "research-original",
    user = "user_alice",
    query?: Record<string, string>,
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/investments/" + path,
      body,
      query,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  const check = (kind: string, r: any) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const validate = ajv.compile(
      (schemas as any)["LightTickInvestmentResearch" + kind + "EnvelopeSchema"],
    );
    assert.ok(
      validate(JSON.parse(JSON.stringify(r.body))),
      JSON.stringify(validate.errors),
    );
    assert.equal(r.headers["Cache-Control"], "no-store");
    return r.body.data;
  };
  const instrument: any = (
    await call(
      "instruments",
      "POST",
      { code: "600000", market: "SSE", kind: "stock", name: "Synthetic" },
      "research-symbol",
    )
  ).body;
  const id = "inv-research-http-fixture",
    body = {
      base_revision: 0,
      instrument_id: instrument.data.instrument.id,
      account_id: null,
      title: "Research",
      horizon: "swing",
      evidence: [],
      market_sources: [],
      ...Object.fromEntries(researchFields.map((k) => [k, ""])),
    };
  const one = check("Entry", await call("research/" + id, "PUT", body));
  assert.equal(one.revision, 1);
  check("Entry", await call("research/" + id));
  check("Page", await call("research"));
  check("History", await call("research/" + id + "/history"));
  assert.equal(
    (
      await call(
        "research/" + id,
        "GET",
        undefined,
        "unused-original",
        "user_bob",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("research/" + id, "PUT", { ...body, title: "changed" }))
      .statusCode,
    409,
  );
  const archived = check(
    "Entry",
    await call(
      "research/" + id + "/archive",
      "POST",
      { base_revision: 1 },
      "archive-original",
    ),
  );
  assert.equal(archived.archived, true);
  assert.equal(check("Page", await call("research")).items.length, 0);
  assert.equal(
    check(
      "Page",
      await call(
        "research",
        "GET",
        undefined,
        "unused-original",
        "user_alice",
        { include_archived: "true" },
      ),
    ).items.length,
    1,
  );
  check(
    "Entry",
    await call(
      "research/" + id + "/restore",
      "POST",
      { base_revision: 2 },
      "restore-original",
    ),
  );
  assert.equal(
    check("Entry", await call("research/" + id, "PUT", body)).revision,
    1,
  );
  assert.equal(
    (
      await call(
        "research/" + id,
        "PUT",
        {
          ...body,
          base_revision: 3,
          evidence: [
            {
              title: "Bad",
              content: "text",
              locator: "",
              source_url: null,
              available_at: "2026-02-30T00:00:00Z",
              contrary_evidence: "",
            },
          ],
        },
        "invalid-evidence",
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "research",
        "GET",
        undefined,
        "unused-original",
        "user_alice",
        { include_archived: "yes" },
      )
    ).statusCode,
    422,
  );
  await app.database.updateAppUserStatus("lighttick", "user_alice", "BLOCKED");
  assert.equal((await call("research/" + id, "PUT", body)).statusCode, 403);
});
