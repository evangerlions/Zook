import assert from "node:assert/strict";
import test from "node:test";
import { supportTelemetry, recordSupportTelemetry } from "../../src/modules/frogsleep/buddy-support/buddy-support-telemetry.ts";

test("support analytics allow only composition and explicit facts without note content or partner identity", async () => {
  const event = supportTelemetry("POST", "/notes", { note: { id: "opaque", created_at: "2026-10-24T00:00:00Z", domain: "sleep",
    template_key: "sleep_goodnight", flower: true, recipient_id: "private-person", context: { id: "secret" } } }, {});
  assert.deepEqual(event?.metadata, { domain: "sleep", kind: "template_flower" });
  assert.equal(supportTelemetry("GET", "/center", { partners: [{ note: "private" }] }, {}), undefined);
  const calls: any[] = [];
  await recordSupportTelemetry({ recordServerEvent: async (value: unknown) => { calls.push(value); } } as never, "actor", event);
  assert.equal(calls[0].dedupeKey, "frogsleep_support_sent:opaque");
  assert.equal(JSON.stringify(calls).includes("private-person"), false);
  assert.equal(JSON.stringify(calls).includes("sleep_goodnight"), false);
});
