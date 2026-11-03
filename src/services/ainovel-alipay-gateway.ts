import { readFile } from "node:fs/promises";
import { AlipaySdk } from "alipay-sdk";
import { alipayProductName } from "../modules/billing/alipay-product-name.ts";
import { ApplicationError } from "../shared/errors.ts";
import { normalizeAlipayPrivateKey } from "../modules/billing/alipay-key-format.ts";
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
        return new AlipaySdk({ appId: this.options.appId!, privateKey: normalizeAlipayPrivateKey(privateKey), alipayPublicKey,
          keyType: "PKCS8", signType: "RSA2", camelcase: false,
          gateway: this.options.environment === "sandbox" ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do" : "https://openapi.alipay.com/gateway.do",
          timeout: 20_000 });
      });
  }
  async payment(order: AlipayOrder): Promise<AlipayPayment> {
    const sdk = await this.client();
    const bizContent = { out_trade_no: order.orderId, ...(order.sellerId ? { seller_id: order.sellerId } : {}),
      total_amount: (order.amountMinor / 100).toFixed(2), subject: alipayProductName(order.productKey),
      time_expire: new Date(Date.parse(order.expiresAt) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " "),
      product_code: order.platform === "android" ? "QUICK_MSECURITY_PAY" : "QUICK_WAP_WAY" };
    const callbacks = this.options.environment === "sandbox" ? {} :
      { notifyUrl: this.options.notifyUrl, returnUrl: this.options.returnUrl };
    const params = { bizContent, ...callbacks };
    if (order.platform === "android") return { type: "app", orderString: sdk.sdkExecute("alipay.trade.app.pay", params) };
    if (order.platform === "web" && order.checkoutMode === "mobile_web") {
      return { type: "page", url: sdk.pageExecute("alipay.trade.wap.pay", "GET", params) };
    }
    if ((order.platform === "web" || order.platform === "windows") && order.checkoutMode === "desktop_web") {
      // No returnUrl: the cashier must not navigate the merchant's parent page.
      // Order query/notify remains the only settlement authority.
      return { type: "page", url: sdk.pageExecute("alipay.trade.page.pay", "GET", {
        ...(this.options.environment === "sandbox" ? {} : { notifyUrl: this.options.notifyUrl }),
        bizContent: { ...bizContent, product_code: "FAST_INSTANT_TRADE_PAY", qr_pay_mode: "4", qrcode_width: 220 },
      }) };
    }
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Unsupported Alipay checkout mode.");
  }

  async query(orderId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    try {
      const response = await (await this.client()).exec("alipay.trade.query", { bizContent: {
        out_trade_no: orderId, query_options: ["trade_settle_info"] } }, { validateSign: true });
      signal?.throwIfAborted();
      return response;
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
