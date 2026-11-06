import { createHash } from "node:crypto";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { learningMigrationFixture } from "../support/native-learning-migration-fixture.ts";
import { courseMigrationFixture } from "../support/learning-route-migration-fixture.ts";
const read = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL("../fixtures/lighttick/" + name, import.meta.url),
      "utf8",
    ),
  );
test("learning golden retains two content versions, original pending commands/receipt hashes and unknown historical time", () => {
  const golden = read("learning-authority-golden.json");
  assert.deepEqual(learningMigrationFixture("risk-baseline-owner"), golden);
  assert.notEqual(golden.old, golden.current);
  assert.equal(golden.bundle.private_states.length, 2);
  assert.equal(
    golden.bundle.receipts.filter((r: any) => r.status === "pending" && r.body)
      .length,
    2,
  );
  assert.equal(golden.bundle.receipts[0].created_at, null);
  assert.notEqual(
    golden.applied.content_version,
    golden.pending.content_version,
  );
  assert.equal(golden.pending.answers[0].answer, "Retained answer");
});
test("formal course golden preserves unpublished revision, both publications and historical lesson mapping", () => {
  const golden = read("course-authority-golden.json");
  assert.deepEqual(courseMigrationFixture("risk-baseline-owner"), golden);
  const route = golden.bundle.routes[0];
  assert.equal(route.revision, 7);
  assert.equal(route.published_version, 2);
  assert.equal(route.versions.length, 2);
  assert.equal(route.versions[0].created_at, null);
  assert.equal(route.lesson_links[0].first_content_version, golden.old);
  assert.equal(route.lesson_links[0].lesson_id, golden.lesson);
});

test("non-LightTick public schema and admin API baseline remain unchanged during Grow extension", () => {
  const golden = read("other-app-contract-baseline.json");
  const entries = Object.entries(schemas)
    .filter(([name]) => !name.startsWith("LightTick"))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(
    entries.map(([name]) => name),
    golden.schema_names,
  );
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(Object.fromEntries(entries)))
      .digest("hex"),
    golden.sha256,
  );
  assert.equal(
    createHash("sha256")
      .update(
        readFileSync(new URL("../../docs/admin-api-spec.md", import.meta.url)),
      )
      .digest("hex"),
    golden.admin_api_spec_sha256,
  );
});
