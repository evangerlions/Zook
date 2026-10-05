import { readFile } from "node:fs/promises";
import { AlipaySdk } from "alipay-sdk";
import { ApplicationError } from "../shared/errors.ts";
import type { AlipayGateway, AlipayOptions, AlipayOrder, AlipayPayment } from "../modules/billing/alipay-models.ts";

/** Official SDK only. Signed strings, private keys and provider payloads are never logged. */
export class OfficialAlipayGateway implements AlipayGateway {
  private sdk?: Promise<AlipaySdk>;
  constructor(private readonly options: AlipayOptions, private readonly testClientFactory?: () => Promise<AlipaySdk>) {}
  private client(): Promise<AlipaySdk> {
    if (this.testClientFactory) return this.sdk ??= this.testClientFactory();
    return this.sdk ??= Promise.all([readFile(this.options.privateKeyPath!, "utf8"), readFile(this.options.publicKeyPath!, "utf8")])
      .then(([privateKey, alipayPublicKey]) => {
        if (!privateKey.trim() || !alipayPublicKey.trim()) throw new Error("Alipay keys unavailable");
        return new AlipaySdk({ appId: this.options.appId!, privateKey, alipayPublicKey,
          keyType: privateKey.includes("BEGIN PRIVATE KEY") ? "PKCS8" : "PKCS1", signType: "RSA2", camelcase: false,
          gateway: this.options.environment === "sandbox" ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do" : "https://openapi.alipay.com/gateway.do",
          timeout: 8000 });
      });
  }
  async payment(order: AlipayOrder): Promise<AlipayPayment> {
    const sdk = await this.client();
    const bizContent = { out_trade_no: order.orderId, ...(order.sellerId ? { seller_id: order.sellerId } : {}),
      total_amount: (order.amountMinor / 100).toFixed(2), subject: `OrangeWrite ${order.productKey}`,
      time_expire: new Date(Date.parse(order.expiresAt) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " "),
      product_code: order.platform === "android" ? "QUICK_MSECURITY_PAY" : "FAST_INSTANT_TRADE_PAY" };
    const params = { bizContent, notifyUrl: this.options.notifyUrl, returnUrl: this.options.returnUrl };
    return order.platform === "android"
      ? { type: "app", orderString: sdk.sdkExecute("alipay.trade.app.pay", params) }
      : { type: "page", url: sdk.pageExecute("alipay.trade.page.pay", "GET", params) };
  }
  async query(orderId: string): Promise<Record<string, unknown>> {
    try {
      return await (await this.client()).exec("alipay.trade.query", { bizContent: {
        out_trade_no: orderId, query_options: ["trade_settle_info"] } }, { validateSign: true });
    } catch (error) {
      // The SDK's exception can embed raw signed response data. Never propagate it to request logs.
      const invalidSignature = error instanceof Error && error.message.startsWith("验签失败");
      throw new ApplicationError(503, invalidSignature ? "BILLING_QUERY_SIGNATURE_INVALID" : "BILLING_PROVIDER_UNAVAILABLE", "Alipay verified query unavailable.");
    }
  }
  async verifyNotify(fields: Record<string, string>): Promise<boolean> {
    if (fields.sign_type !== "RSA2" || !fields.sign) return false;
    return (await this.client()).checkNotifySignV2(fields);
  }
}
export function alipayEnvironmentOptions(): AlipayOptions {
  const environment = process.env.ALIPAY_AI_NOVEL_ENVIRONMENT;
  let prices: AlipayOptions["prices"];
  if (process.env.ALIPAY_AI_NOVEL_PRICES_JSON) {
    try { prices = JSON.parse(process.env.ALIPAY_AI_NOVEL_PRICES_JSON); }
    catch { prices = {} as NonNullable<AlipayOptions["prices"]>; }
  }
  return { enabled: process.env.ALIPAY_AI_NOVEL_ENABLED === "true",
    prices, pricesApproved: process.env.ALIPAY_AI_NOVEL_PRICES_APPROVED === "true",
    appId: process.env.ALIPAY_AI_NOVEL_APP_ID, sellerId: process.env.ALIPAY_AI_NOVEL_SELLER_ID?.trim() || undefined,
    notifyUrl: process.env.ALIPAY_AI_NOVEL_NOTIFY_URL, returnUrl: process.env.ALIPAY_AI_NOVEL_RETURN_URL,
    privateKeyPath: process.env.ALIPAY_AI_NOVEL_PRIVATE_KEY_PATH, publicKeyPath: process.env.ALIPAY_AI_NOVEL_PUBLIC_KEY_PATH,
    environment: environment === "production" || environment === "sandbox" ? environment : undefined };
}
