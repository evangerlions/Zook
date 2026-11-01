import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { supportTemplates } from "../../src/modules/frogsleep/buddy-support/buddy-support.types.ts";
import { submission } from "../../src/modules/frogsleep/buddy-support/buddy-support-validation.ts";

test("Zook validates the same versioned template and date fixture as both clients", () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/buddy-support-v1.json", import.meta.url), "utf8"));
  assert.deepEqual(new Set(fixture.templates), new Set(Object.keys(supportTemplates)));
  const note = fixture.center.partners[0].latest_received_note;
  const parsed = submission({ relationship_id: note.relationship_id, operation_id: fixture.operation.operation_id,
    template_key: note.template_key, flower: note.flower });
  assert.equal(parsed.template_key, note.template_key);
  assert.equal(supportTemplates[note.template_key], note.domain);
  assert.equal(Date.parse(note.created_at), 1792836000123);
  assert.equal(fixture.center.partners[0].relationships[0].own_receive_enabled, false);
});
