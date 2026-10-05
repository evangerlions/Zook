import assert from "node:assert/strict";
import test from "node:test";
import { ALIPAY_ORDER_ID_PATTERN, createAlipayOrderId } from "../../src/modules/billing/alipay-order-id.ts";
import type { AlipayPlatform, AlipayProductKey } from "../../src/modules/billing/alipay-models.ts";

test("order identity encodes every scene and product, raw user prefix and random suffix", () => {
  const scenes: [AlipayPlatform, string][] = [["android", "and"], ["web", "web"], ["windows", "win"]];
  const products: [AlipayProductKey, string][] = [["plus_monthly", "a01"], ["plus_quarterly", "a03"],
    ["plus_yearly", "a12"], ["pro_monthly", "b01"], ["pro_quarterly", "b03"], ["pro_yearly", "b12"]];
  for (const [platform, scene] of scenes) for (const [product, code] of products) {
    const id = createAlipayOrderId(platform, product, "abc123456789");
    assert.match(id, new RegExp(`^ow_${scene}_${code}_abc123_[a-f0-9]{16}$`));
    assert.match(id, ALIPAY_ORDER_ID_PATTERN);
    assert.ok(id.length <= 64);
    assert.notEqual(id, createAlipayOrderId(platform, product, "abc123456789"));
  }
  assert.match(createAlipayOrderId("web", "pro_yearly", "u1"), /^ow_web_b12_u1_[a-f0-9]{16}$/);
  assert.match(createAlipayOrderId("web", "pro_yearly", "user_alice"), ALIPAY_ORDER_ID_PATTERN);
  assert.throws(() => createAlipayOrderId("web", "pro_yearly", ""));
  assert.throws(() => createAlipayOrderId("web", "pro_yearly", "bad/id"));
});

test("recognizes old orders but rejects unsupported scenes, products and random sizes", () => {
  for (const prefix of ["ow", "alp"]) assert.match(`${prefix}_${"a".repeat(32)}`, ALIPAY_ORDER_ID_PATTERN);
  for (const id of ["ow_app_a01_abc123_7d43b290fe8216ac", "ow_and_a02_abc123_7d43b290fe8216ac",
    "ow_and_a01_abc123_7d43", "ow_and_c01_abc123_7d43b290fe8216ac"])
    assert.equal(ALIPAY_ORDER_ID_PATTERN.test(id), false);
});
