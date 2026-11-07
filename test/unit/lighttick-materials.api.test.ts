import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
test("material HTTP/OpenAPI has registered owner isolation, exact pinned cross-research sources, archive and durable originals", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "material-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  seed.users.push({
    ...seed.users[0],
    id: "user_material_unjoined",
    email: "material-unjoined@example.invalid",
  });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "material-original",
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
      (schemas as any)["LightTickInvestmentMaterial" + kind + "EnvelopeSchema"],
    );
    assert.ok(
      validate(JSON.parse(JSON.stringify(r.body))),
      JSON.stringify(validate.errors),
    );
    assert.equal(r.headers["Cache-Control"], "no-store");
    return r.body.data;
  };
  const mid = "inv-material-http-fixture",
    b = {
      base_revision: 0,
      title: "Source",
      content: "  source\r\ncontent ",
      locator: "page 1",
      source_url: "https://example.invalid/source",
      available_at: "2026-10-01T00:00:00Z",
      contrary_evidence: "uncertain",
    };
  const m = check("Entry", await call("materials/" + mid, "PUT", b));
  assert.equal(m.content, b.content);
  assert.deepEqual(check("Entry", await call("materials/" + mid, "PUT", b)), m);
  assert.equal(
    (await call("materials/" + mid, "PUT", { ...b, content: "different" }))
      .statusCode,
    409,
  );
  assert.equal(
    (await call("materials/" + mid, "GET", undefined, "read-other", "user_bob"))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "materials/" + mid,
        "GET",
        undefined,
        "read-no-membership",
        "user_material_unjoined",
      )
    ).statusCode,
    403,
  );
  check("Page", await call("materials"));
  check("History", await call("materials/" + mid + "/history"));
  check("Entry", await call("materials/" + mid + "/versions/1"));
  const i: any = (
    await call(
      "instruments",
      "POST",
      { code: "600000", market: "SSE", kind: "stock", name: "Synthetic" },
      "symbol-original",
    )
  ).body;
  const rb = {
    base_revision: 0,
    instrument_id: i.data.instrument.id,
    account_id: null,
    title: "Dossier",
    horizon: "short",
    evidence: [],
    market_sources: [],
    material_sources: [
      { id: mid, version: 1, content_digest: m.content_digest },
    ],
    ...Object.fromEntries(researchFields.map((k) => [k, ""])),
  };
  const research = await call(
    "research/inv-material-dossier",
    "PUT",
    rb,
    "research-original",
  );
  assert.equal(research.statusCode, 200);
  const validate = ajv.compile(
    schemas.LightTickInvestmentResearchEntryEnvelopeSchema,
  );
  assert.ok(
    validate(JSON.parse(JSON.stringify(research.body))),
    JSON.stringify(validate.errors),
  );
  const refs = check(
    "References",
    await call("materials/" + mid + "/references"),
  );
  assert.equal(refs.items[0].material_version, 1);
  const archived = check(
    "Entry",
    await call(
      "materials/" + mid + "/archive",
      "POST",
      { base_revision: 1 },
      "archive-original",
    ),
  );
  assert.equal(archived.archived, true);
  assert.equal(check("Page", await call("materials")).items.length, 0);
  assert.equal(
    check(
      "Page",
      await call("materials", "GET", undefined, "list-original", "user_alice", {
        include_archived: "true",
      }),
    ).items.length,
    1,
  );
  assert.equal(
    (
      await call(
        "research/inv-material-new-dossier",
        "PUT",
        rb,
        "archived-link-original",
      )
    ).statusCode,
    409,
  );
  assert.equal(
    check(
      "Entry",
      await call(
        "materials/" + mid + "/restore",
        "POST",
        { base_revision: 2 },
        "restore-original",
      ),
    ).id,
    mid,
  );
  assert.equal(
    (
      await call(
        "materials/" + mid + "/history",
        "GET",
        undefined,
        "invalid-limit",
        "user_alice",
        { limit: "21" },
      )
    ).statusCode,
    422,
  );
  await app.database.updateAppUserStatus("lighttick", "user_alice", "BLOCKED");
  assert.equal((await call("materials/" + mid)).statusCode, 403);
});
