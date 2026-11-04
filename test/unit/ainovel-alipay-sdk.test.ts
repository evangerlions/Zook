import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { AlipaySdk } from "alipay-sdk";
import { OfficialAlipayGateway } from "../../src/services/ainovel-alipay-gateway.ts";

test("official SDK query rejects missing, invalid and modified signatures; accepts signed response without app_id", async () => {
  // Ephemeral test keys only; no registered merchant key or network payment.
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const payload = JSON.stringify({ code: "10000", out_trade_no: "alp_test", trade_no: "202610040000000001", total_amount: "38.00", trade_status: "TRADE_SUCCESS", send_pay_date: "2026-10-04 18:00:00" });
  const signature = sign("RSA-SHA256", Buffer.from(payload), keys.privateKey).toString("base64");
  let response = `{"alipay_trade_query_response":${payload},"sign":"${signature}"}`;
  const server = createServer((req, res) => { req.resume(); res.setHeader("content-type", "application/json"); res.end(response); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const sdk = new AlipaySdk({ appId: "test_merchant", privateKey: keys.privateKey, alipayPublicKey: keys.publicKey,
      keyType: "PKCS8", signType: "RSA2", camelcase: false, gateway: `http://127.0.0.1:${port}/gateway.do` });
    const gateway = new OfficialAlipayGateway({}, async () => sdk);
    assert.equal((await gateway.query("alp_test")).out_trade_no, "alp_test");
    response = `{"alipay_trade_query_response":${payload}}`;
    await assert.rejects(() => gateway.query("alp_test"));
    response = `{"alipay_trade_query_response":${payload},"sign":"invalid"}`;
    await assert.rejects(() => gateway.query("alp_test"));
    response = `{"alipay_trade_query_response":${payload.replace("38.00", "0.01")},"sign":"${signature}"}`;
    await assert.rejects(() => gateway.query("alp_test"));
    const fields = { app_id: "test_merchant", out_trade_no: "alp_test", total_amount: "38.00", sign_type: "RSA2" };
    const canonical = Object.entries(fields).filter(([key]) => key !== "sign_type").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
    const notifySign = sign("RSA-SHA256", Buffer.from(canonical), keys.privateKey).toString("base64");
    assert.equal(await gateway.verifyNotify({ ...fields, sign: notifySign }), true);
    assert.equal(await gateway.verifyNotify({ ...fields, total_amount: "0.01", sign: notifySign }), false);
    assert.equal(await gateway.verifyNotify({ ...fields, sign_type: "RSA", sign: notifySign }), false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
