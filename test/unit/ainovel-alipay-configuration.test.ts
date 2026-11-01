import assert from "node:assert/strict";
import { test } from "node:test";
import { alipayConfigured, ALIPAY_PRICES } from "../../src/modules/billing/alipay-policy.ts";
import type { AlipayOptions } from "../../src/modules/billing/alipay-models.ts";

const sandbox: AlipayOptions = {
  appId: "merchant", environment: "sandbox", privateKeyPath: "/private/key",
  publicKeyPath: "/private/public", notifyUrl: "https://example.test/notify",
  returnUrl: "https://example.test/return",
};

test("Alipay availability follows required configuration, without an enable flag", () => {
  assert.equal(alipayConfigured(sandbox), true);
  for (const key of ["appId", "environment", "privateKeyPath", "publicKeyPath", "notifyUrl", "returnUrl"] as const) {
    assert.equal(alipayConfigured({ ...sandbox, [key]: undefined }), false, key);
  }
  assert.equal(alipayConfigured({ ...sandbox, notifyUrl: "http://example.test" }), false);
  assert.equal(alipayConfigured({ ...sandbox, environment: "production" }), false);
  assert.equal(alipayConfigured({ ...sandbox, environment: "production", prices: ALIPAY_PRICES, pricesApproved: true }), true);
  assert.equal(alipayConfigured({ ...sandbox, environment: "production", prices: ALIPAY_PRICES, pricesApproved: false }), false);
});
