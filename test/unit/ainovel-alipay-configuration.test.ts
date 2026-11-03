import assert from "node:assert/strict";
import { test } from "node:test";
import { alipayConfigured, parseAlipayMoney } from "../../src/modules/billing/alipay-policy.ts";
import { validAlipayPrices, MAX_ALIPAY_PRICE_MINOR } from "../../src/modules/billing/ainovel-alipay-pricing.ts";
import { TEST_ALIPAY_PRICES } from "../support/alipay-pricing-fixture.ts";
import type { AlipayOptions } from "../../src/modules/billing/alipay-models.ts";

const sandbox: AlipayOptions = {
  appId: "merchant", environment: "sandbox", privateKeyPath: "/private/key",
  publicKeyPath: "/private/public", notifyUrl: "https://example.test/notify",
  returnUrl: "https://example.test/return",
};

test("Alipay availability follows required configuration, without an enable flag", () => {
  assert.equal(alipayConfigured(sandbox), true);
  for (const key of ["appId", "environment", "privateKeyPath", "publicKeyPath"] as const) {
    assert.equal(alipayConfigured({ ...sandbox, [key]: undefined }), false, key);
  }
  assert.equal(alipayConfigured({ ...sandbox, notifyUrl: undefined, returnUrl: undefined }), true);
  assert.equal(alipayConfigured({ ...sandbox, notifyUrl: "http://example.test", returnUrl: "invalid" }), true);
  assert.equal(alipayConfigured({ ...sandbox, environment: "production" }), true);
  assert.equal(alipayConfigured({ ...sandbox, environment: "production", notifyUrl: undefined }), false);
  assert.equal(alipayConfigured({ ...sandbox, environment: "production", returnUrl: "http://example.test" }), false);
});

test("new sales require a complete catalog of positive integer minor-unit prices", () => {
  assert.equal(validAlipayPrices(TEST_ALIPAY_PRICES), true);
  for (const prices of [undefined, null, [], {}, { ...TEST_ALIPAY_PRICES, unknown: 100 }]) {
    assert.equal(validAlipayPrices(prices), false);
  }
  for (const product of Object.keys(TEST_ALIPAY_PRICES)) {
    for (const value of [undefined, 0, -1, 1.5, MAX_ALIPAY_PRICE_MINOR + 1, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(validAlipayPrices({ ...TEST_ALIPAY_PRICES, [product]: value }), false, `${product}: ${value}`);
    }
  }
});

test("accepted price bounds round-trip through checkout and settlement amounts", () => {
  for (const value of [1, MAX_ALIPAY_PRICE_MINOR]) {
    assert.equal(validAlipayPrices({ ...TEST_ALIPAY_PRICES, plus_monthly: value }), true);
    assert.equal(parseAlipayMoney((value / 100).toFixed(2)), value);
  }
});
