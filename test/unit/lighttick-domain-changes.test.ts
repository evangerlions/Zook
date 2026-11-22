import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import { domainHint } from "../../src/modules/lighttick/domain-changes/domain-changes.types.ts";
import { DomainChangesService } from "../../src/modules/lighttick/domain-changes/domain-changes.service.ts";
import {
  exerciseDomainChanges,
  domainChangesOwner as o,
} from "../support/domain-changes-acceptance.ts";
test("domain hints are atomic, deduplicated, private, cursor-bound and excluded from legacy sync", async () => {
  await exerciseDomainChanges(new InMemoryLightTickRepository());
});
test("notification cursors reject malformed ranges and recheck current authorization", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new DomainChangesService(repo);
  for (const q of [
    { cursor: "?" },
    { cursor: "e30" },
    { domain: "unknown" },
    { start: "oldest" },
    { start: "latest", cursor: "abc" },
    { limit: "101" },
    { limit: "0" },
    { limit: "NaN" },
  ])
    await assert.rejects(s.read(o, q), (e) =>
      [409, 422].includes((e as any).statusCode),
    );
  for (const after of ["01", "-1", "9223372036854775808", 1]) {
    const cursor = Buffer.from(
      JSON.stringify({ owner: digest(o), domain: null, after }),
    ).toString("base64url");
    await assert.rejects(s.read(o, { cursor }));
  }
  let calls = 0;
  const gated = new DomainChangesService(repo, async () => {
    ++calls;
    throw Error("revoked");
  });
  await assert.rejects(gated.read(o, { start: "latest" }), /revoked/);
  assert.equal(calls, 1);
  const hint = {
    domain: "reading",
    resource: "article",
    id: "article-safe",
    revision: 1,
    operation: "upsert",
  };
  for (const bad of [
    { ...hint, body: "secret" },
    { ...hint, id: "secret url?" },
    { ...hint, revision: 0 },
    { ...hint, resource: "a.b" },
  ])
    assert.throws(() => domainHint(bad));
});
