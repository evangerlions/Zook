import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCredential,
  countTokens,
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
