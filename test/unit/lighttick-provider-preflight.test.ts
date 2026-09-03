import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCredential,
  countTokens,
  evaluatePushReadiness,
  parseEnvironment,
} from "../../scripts/lighttick-provider-preflight.mjs";

test("provider preflight parses container variables without exposing values", () => {
  assert.deepEqual(parseEnvironment(["A=one=two", "B=", "C"]), { A: "one=two", B: "", C: "" });
  assert.equal(classifyCredential("mock-bailian-api-key"), "mock_or_missing");
  assert.equal(classifyCredential("********"), "mock_or_missing");
  assert.equal(classifyCredential("real-provider-secret"), "configured");
});

test("provider preflight requires multiple non-empty device tokens", () => {
  assert.equal(countTokens(" first, second ,, third "), 3);
  assert.equal(countTokens(undefined), 0);
});

const readyInput = {
  apnsKeyIdPresent: true,
  apnsTeamIdPresent: true,
  apnsSharedTopicPresent: true,
  lightTickApnsTopicPresent: true,
  apnsKeyReadable: true,
  apnsSandbox: true,
  apnsTokenCount: 2,
  fcmProjectPresent: true,
  fcmServiceAccountReadable: true,
  fcmTokenCount: 2,
};

test("push preflight requires the shared APNs topic used to construct the runtime dispatcher", () => {
  const result = evaluatePushReadiness({ ...readyInput, apnsSharedTopicPresent: false });

  assert.equal(result.apns.configured, false);
  assert.ok(result.issues.includes("apns_runtime_topic_missing"));
});

test("push preflight requires the LightTick APNs topic used for app-scoped delivery", () => {
  const result = evaluatePushReadiness({ ...readyInput, lightTickApnsTopicPresent: false });

  assert.equal(result.apns.configured, false);
  assert.ok(result.issues.includes("lighttick_apns_topic_missing"));
});

test("push preflight accepts APNs and FCM only when runtime configuration and multi-device tokens are ready", () => {
  const result = evaluatePushReadiness(readyInput);

  assert.deepEqual(result, {
    apns: { configured: true, sandbox: true, deviceTokenCount: 2 },
    fcm: { configured: true, deviceTokenCount: 2 },
    issues: [],
  });
});
