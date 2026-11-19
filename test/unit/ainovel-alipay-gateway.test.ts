import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { AlipaySdk } from "alipay-sdk";
import { OfficialAlipayGateway } from "../../src/services/ainovel-alipay-gateway.ts";
import type { AlipayOrder } from "../../src/modules/billing/alipay-models.ts";

// Ephemeral test credentials only. No merchant network requests or real keys.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const sdk = new AlipaySdk({ appId: "test_app", signType: "RSA2", keyType: "PKCS8",
  privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  alipayPublicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  gateway: "https://openapi-sandbox.dl.alipaydev.com/gateway.do" });
const notifyUrl = "https://zook.example.test/api/v1/ai_novel/billing/webhooks/alipay";
const returnUrl = "https://client.example.test/#/membership";
const gateway = new OfficialAlipayGateway({ notifyUrl, returnUrl }, async () => sdk);

test("local production SDK checkout signs normally without a public notify URL", async () => {
  const local = new OfficialAlipayGateway({ environment: "production", returnUrl }, async () => sdk);
  for (const [platform, checkoutMode] of [
    ["android", undefined], ["web", "mobile_web"], ["web", "desktop_web"], ["windows", "desktop_web"],
  ] as const) {
    const payment = await local.payment({ ...order(platform), environment: "production", checkoutMode });
    const params = payment.type === "app" ? new URLSearchParams(payment.orderString) : new URL(payment.url).searchParams;
    assert.equal(params.has("notify_url"), false);
    assert.ok(params.get("sign"));
    assert.equal(params.get("return_url"), checkoutMode === "desktop_web" ? null : returnUrl);
  }
});

test("sandbox checkout omits callback URLs even when placeholders are configured", async () => {
  const sandboxGateway = new OfficialAlipayGateway({ environment: "sandbox", notifyUrl: "http://localhost/notify", returnUrl: "invalid" }, async () => sdk);
  for (const platform of ["android", "web"] as const) {
    const payment = await sandboxGateway.payment({ ...order(platform), checkoutMode: platform === "web" ? "mobile_web" : undefined });
    const params = payment.type === "app" ? new URLSearchParams(payment.orderString) : new URL(payment.type === "page" ? payment.url : "").searchParams;
    assert.equal(params.has("notify_url"), false);
    assert.equal(params.has("return_url"), false);
  }
  for (const platform of ["web", "windows"] as const) {
    const desktop = await sandboxGateway.payment({ ...order(platform), checkoutMode: "desktop_web" });
    assert.equal(desktop.type, "page");
    if (desktop.type !== "page") throw new Error("Expected page payment");
    assert.equal(new URL(desktop.url).searchParams.has("notify_url"), false);
    assert.equal(new URL(desktop.url).searchParams.has("return_url"), false);
  }
});

function order(platform: AlipayOrder["platform"]): AlipayOrder {
  return { platform, distribution: platform === "android" ? "direct_android" : platform,
    productKey: "plus_monthly", idempotencyKey: "test_intent", orderId: "alp_test", appId: "ai_novel",
    userId: "test_user", provider: "alipay", merchantAppId: "test_app", sellerId: "test_seller",
    environment: "sandbox", status: "pending", amountMinor: 3800, currency: "CNY",
    createdAt: "2026-10-04T00:00:00Z", expiresAt: "2026-10-04T00:30:00Z",
    paidAt: null, providerTransactionId: null, membershipApplied: false,
    membershipExpiresAt: null, conflict: null, accountDeletedAt: null };
}

for (const platform of ["android", "web"] as const) {
  test(`official SDK includes configured callback URLs in ${platform} checkout`, async () => {
    const payment = await gateway.payment({ ...order(platform), checkoutMode: platform === "web" ? "mobile_web" : undefined });
    assert.equal(payment.type, platform === "android" ? "app" : "page");
    const params = payment.type === "app" ? new URLSearchParams(payment.orderString) : new URL(payment.type === "page" ? payment.url : "").searchParams;
    assert.equal(params.get("method"), platform === "android" ? "alipay.trade.app.pay" : "alipay.trade.wap.pay");
    assert.equal(params.get("notify_url"), notifyUrl);
    assert.equal(params.get("return_url"), returnUrl);
    assert.equal(params.get("sign_type"), "RSA2");
    assert.ok(params.get("sign"));
    const biz = JSON.parse(params.get("biz_content")!);
    assert.equal(biz.seller_id, "test_seller");
    assert.equal(biz.out_trade_no, "alp_test");
    assert.equal(biz.total_amount, "38.00");
    assert.equal(biz.subject, "橘子写作 Plus 月度会员");
  });
}

test("official SDK verifies decoded full-refund callback fields and rejects tampering", async () => {
  const fields: Record<string, string> = { app_id: "test_app", seller_id: "test_seller",
    out_trade_no: "alp_test", total_amount: "38.00", trade_status: "TRADE_CLOSED",
    refund_fee: "38.00", gmt_refund: "2026-10-04 18:00:00.320",
    subject: "OrangeWrite 会员 + Plus", sign_type: "RSA2" };
  const content = Object.keys(fields).filter(key => key !== "sign_type").sort()
    .map(key => `${key}=${fields[key]}`).join("&");
  fields.sign = sign("RSA-SHA256", Buffer.from(content), keys.privateKey).toString("base64");
  assert.equal(await gateway.verifyNotify(fields), true);
  assert.equal(await gateway.verifyNotify({ ...fields, total_amount: "0.01" }), false);
  assert.equal(await gateway.verifyNotify({ ...fields, refund_fee: "0.01" }), false);
  assert.equal(await gateway.verifyNotify({ ...fields, gmt_refund: "2026-10-04 18:00:00.321" }), false);
  assert.equal(await gateway.verifyNotify({ ...fields, sign_type: "RSA" }), false);
});

test("default signing merchant omits seller_id from every checkout platform", async () => {
  for (const platform of ["android", "web"] as const) {
    const payment = await gateway.payment({ ...order(platform), sellerId: "", checkoutMode: platform === "web" ? "mobile_web" : undefined });
    const params = payment.type === "app" ? new URLSearchParams(payment.orderString) : new URL(payment.type === "page" ? payment.url : "").searchParams;
    assert.equal(Object.hasOwn(JSON.parse(params.get("biz_content")!), "seller_id"), false);
    assert.equal(params.get("notify_url"), notifyUrl);
  }
});

test("desktop checkout never falls back to provider precreation", async () => {
  const client = { exec: async () => { throw new Error("Must not call provider precreation"); } } as unknown as AlipaySdk;
  const unsupported = new OfficialAlipayGateway({}, async () => client);
  for (const platform of ["web", "windows"] as const) {
    await assert.rejects(unsupported.payment(order(platform)), /Unsupported Alipay checkout mode/);
  }
});

for (const platform of ["web", "windows"] as const) {
test(`${platform} embedded cashier is signed with frozen order facts and no parent return`, async () => {
  const payment = await gateway.payment({ ...order(platform), checkoutMode: "desktop_web" });
  assert.equal(payment.type, "page");
  if (payment.type !== "page") throw new Error("Expected page payment");
  const url = new URL(payment.url);
  assert.equal(url.origin, "https://openapi-sandbox.dl.alipaydev.com");
  const params = url.searchParams;
  assert.equal(params.get("method"), "alipay.trade.page.pay");
  assert.equal(params.get("app_id"), "test_app");
  assert.equal(params.get("notify_url"), notifyUrl);
  assert.equal(params.has("return_url"), false);
  assert.equal(params.get("sign_type"), "RSA2");
  assert.ok(params.get("sign"));
  const biz = JSON.parse(params.get("biz_content")!);
  assert.equal(biz.product_code, "FAST_INSTANT_TRADE_PAY");
  assert.equal(biz.qr_pay_mode, "4");
  assert.equal(biz.qrcode_width, 220);
  assert.equal(biz.out_trade_no, "alp_test");
  assert.equal(biz.total_amount, "38.00");
  assert.equal(biz.seller_id, "test_seller");
  assert.equal(biz.time_expire, "2026-10-04 08:30:00");
});
}


for (const [productKey, name] of [
  ["plus_monthly", "橘子写作 Plus 月度会员"],
  ["plus_quarterly", "橘子写作 Plus 季度会员"],
  ["plus_yearly", "橘子写作 Plus 年度会员"],
  ["pro_monthly", "橘子写作 Pro 月度会员"],
  ["pro_quarterly", "橘子写作 Pro 季度会员"],
  ["pro_yearly", "橘子写作 Pro 年度会员"],
] as const) {
  test(`${productKey} sends a customer-facing subject in every Alipay cashier`, async () => {
    for (const [platform, checkoutMode] of [
      ["android", undefined], ["web", "mobile_web"], ["web", "desktop_web"], ["windows", "desktop_web"],
    ] as const) {
      const payment = await gateway.payment({ ...order(platform), productKey, checkoutMode });
      const params = payment.type === "app" ? new URLSearchParams(payment.orderString)
        : new URL(payment.type === "page" ? payment.url : "").searchParams;
      const biz = JSON.parse(params.get("biz_content")!);
      assert.equal(biz.subject, name);
      assert.ok(!biz.subject.includes(productKey));
      assert.equal(biz.out_trade_no, "alp_test");
      assert.equal(biz.total_amount, "38.00");
    }

  });
}
