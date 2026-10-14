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
    assert.notEqual(payment.type, "qr");
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
  });
}

test("official SDK verifies decoded callback values and rejects tampering", async () => {
  const fields: Record<string, string> = { app_id: "test_app", seller_id: "test_seller",
    out_trade_no: "alp_test", total_amount: "38.00", trade_status: "TRADE_SUCCESS",
    subject: "OrangeWrite 会员 + Plus", sign_type: "RSA2" };
  const content = Object.keys(fields).filter(key => key !== "sign_type").sort()
    .map(key => `${key}=${fields[key]}`).join("&");
  fields.sign = sign("RSA-SHA256", Buffer.from(content), keys.privateKey).toString("base64");
  assert.equal(await gateway.verifyNotify(fields), true);
  assert.equal(await gateway.verifyNotify({ ...fields, total_amount: "0.01" }), false);
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

test("desktop Web and Windows precreate a verified QR without an external page", async () => {
  for (const platform of ["web", "windows"] as const) {
    const client = { exec: async (method: string, params: any, options: any) => {
      assert.equal(method, "alipay.trade.precreate");
      assert.equal(options.validateSign, true);
      assert.equal(params.notifyUrl, notifyUrl);
      assert.equal(params.bizContent.total_amount, "38.00");
      assert.equal(params.bizContent.out_trade_no, "alp_test");
      assert.equal(params.bizContent.product_code, undefined);
      return { code: "10000", out_trade_no: "alp_test", qr_code: "https://qr.alipay.com/test" };
    }} as unknown as AlipaySdk;
    const qrGateway = new OfficialAlipayGateway({ notifyUrl, returnUrl }, async () => client);
    assert.deepEqual(await qrGateway.payment(order(platform)), { type: "qr", qrCode: "https://qr.alipay.com/test" });
  }
});

test("precreate rejects wrong order identity and sanitizes provider exceptions", async () => {
  for (const result of [{ code: "10000", out_trade_no: "other", qr_code: "opaque" }, { code: "40004" }]) {
    const client = { exec: async () => result } as unknown as AlipaySdk;
    const qrGateway = new OfficialAlipayGateway({}, async () => client);
    await assert.rejects(qrGateway.payment(order("web")), /Alipay QR checkout unavailable/);
  }
});
