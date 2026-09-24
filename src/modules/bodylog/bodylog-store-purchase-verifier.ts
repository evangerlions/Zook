import { createSign, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import { ApplicationError } from "../../shared/errors.ts";

export type BodyLogStorePlatform = "ios" | "android";
export interface BodyLogPurchaseProof {
  platform: BodyLogStorePlatform;
  productId: string;
  signedTransaction?: string;
  purchaseToken?: string;
}
export interface VerifiedBodyLogPurchase {
  platform: BodyLogStorePlatform;
  productId: string;
  tier: "plus" | "pro";
  startedAt: string;
  expiresAt: string;
  autoRenew: boolean;
  transactionId: string;
  originalTransactionId: string;
}

const APPLE_PRODUCTS: Record<string, "pro"> = {
  "com.habitap.onemonth1": "pro",
  "com.habitap.year1": "pro",
  "com.bodylog.premium.monthly": "pro",
  "com.bodylog.premium.yearly": "pro",
};
const GOOGLE_PRODUCTS: Record<string, "plus" | "pro" | "lifetime"> = {
  premium_monthly: "pro", premium_yearly: "pro", premium_lifetime: "lifetime",
  plus_monthly: "plus", plus_yearly: "plus",
};
const LIFETIME_EXPIRY = "9999-12-31T23:59:59.999Z";

function unavailable(): ApplicationError {
  return new ApplicationError(503, "BODYLOG_PURCHASE_VERIFICATION_UNAVAILABLE", "Store purchase verification is not configured.");
}
function invalidProof(): ApplicationError {
  return new ApplicationError(400, "BODYLOG_PURCHASE_INVALID", "The store purchase could not be verified.");
}
function decodeJwsPayload(jws: string): Record<string, unknown> {
  if (jws.length > 64_000) throw invalidProof();
  const parts = jws.split(".");
  if (parts.length !== 3) throw invalidProof();
  try {
    return JSON.parse(Buffer.from((parts[1] as string).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch { throw invalidProof(); }
}

/** Store credentials are read per verification and are never copied into logs or request state. */
export class BodyLogStorePurchaseVerifier {
  async verify(proof: BodyLogPurchaseProof): Promise<VerifiedBodyLogPurchase> {
    if (proof.platform === "ios") return await this.verifyApple(proof);
    if (proof.platform === "android") return await this.verifyGoogle(proof);
    throw invalidProof();
  }

  private async verifyApple(proof: BodyLogPurchaseProof): Promise<VerifiedBodyLogPurchase> {
    const jws = proof.signedTransaction;
    const rootPaths = process.env.BODYLOG_APPLE_ROOT_CA_PATHS?.split(",").map((path) => path.trim()).filter(Boolean) ?? [];
    const bundleId = process.env.BODYLOG_APPLE_BUNDLE_ID?.trim() || "com.youwoai.habittap";
    if (!jws || rootPaths.length === 0) throw unavailable();
    let rootBuffers: Buffer[];
    try { rootBuffers = await Promise.all(rootPaths.map((path) => readFile(path))); }
    catch { throw unavailable(); }
    try {
      const untrustedPayload = decodeJwsPayload(jws);
      const environmentName = String(untrustedPayload.environment ?? "");
      const environment = environmentName === "Production" ? Environment.PRODUCTION
        : environmentName === "Sandbox" ? Environment.SANDBOX : null;
      if (!environment) throw invalidProof();
      const appAppleIdRaw = process.env.BODYLOG_APPLE_APP_ID?.trim();
      const appAppleId = appAppleIdRaw ? Number(appAppleIdRaw) : undefined;
      if (environment === Environment.PRODUCTION && (!Number.isSafeInteger(appAppleId) || !appAppleId)) throw unavailable();
      const verifier = new SignedDataVerifier(rootBuffers, true, environment, bundleId, appAppleId);
      const payload = await verifier.verifyAndDecodeTransaction(jws);

      const productId = String(payload.productId ?? "");
      const tier = APPLE_PRODUCTS[productId];
      const expiration = Number(payload.expiresDate);
      const purchaseDate = Number(payload.purchaseDate);
      const originalTransactionId = String(payload.originalTransactionId ?? "");
      const transactionId = String(payload.transactionId ?? "");
      if (payload.environment !== environmentName || payload.bundleId !== bundleId || !tier || proof.productId !== productId || !originalTransactionId || !transactionId || !Number.isFinite(purchaseDate)) throw invalidProof();
      const revokedAt = payload.revocationDate == null ? null : Number(payload.revocationDate);
      const expiresAt = revokedAt != null && Number.isFinite(revokedAt) ? new Date(Math.min(revokedAt, Date.now())).toISOString()
        : Number.isFinite(expiration) ? new Date(expiration).toISOString() : invalidProof();
      return { platform: "ios", productId, tier, startedAt: new Date(purchaseDate).toISOString(), expiresAt,
        autoRenew: false, transactionId, originalTransactionId };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw invalidProof();
    }
  }

  private async verifyGoogle(proof: BodyLogPurchaseProof): Promise<VerifiedBodyLogPurchase> {
    const purchaseToken = proof.purchaseToken;
    const packageName = process.env.BODYLOG_GOOGLE_PLAY_PACKAGE?.trim() || "com.youwoai.habittap";
    const serviceAccountPath = process.env.BODYLOG_GOOGLE_PLAY_SERVICE_ACCOUNT_PATH?.trim();
    if (!purchaseToken || purchaseToken.length > 8_000 || !serviceAccountPath) throw unavailable();
    const plan = GOOGLE_PRODUCTS[proof.productId];
    if (!plan) throw invalidProof();
    try {
      const account = JSON.parse(await readFile(serviceAccountPath, "utf8")) as { client_email?: string; private_key?: string; token_uri?: string };
      if (!account.client_email || !account.private_key) throw unavailable();
      const nowSeconds = Math.floor(Date.now() / 1000);
      const assertion = signServiceAccountJwt(account.client_email, account.private_key, account.token_uri || "https://oauth2.googleapis.com/token", nowSeconds);
      const tokenResponse = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenResponse.ok) throw unavailable();
      const tokenBody = await tokenResponse.json() as { access_token?: string };
      if (!tokenBody.access_token) throw unavailable();
      const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
      if (plan === "lifetime") {
        const response = await fetch(`${base}/purchases/products/${encodeURIComponent(proof.productId)}/tokens/${encodeURIComponent(purchaseToken)}`, {
          headers: { authorization: `Bearer ${tokenBody.access_token}` }, signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw invalidProof();
        const purchase = await response.json() as { productId?: string; purchaseState?: number; purchaseTimeMillis?: string; purchaseToken?: string };
        if (purchase.productId !== proof.productId || purchase.purchaseState !== 0 || (purchase.purchaseToken && purchase.purchaseToken !== purchaseToken)) throw invalidProof();
        const startedAt = new Date(Number(purchase.purchaseTimeMillis)).toISOString();
        const tokenHash = createHash("sha256").update(purchaseToken).digest("hex");
        return { platform: "android", productId: proof.productId, tier: "pro", startedAt, expiresAt: LIFETIME_EXPIRY,
          autoRenew: false, transactionId: tokenHash, originalTransactionId: `google:${tokenHash}` };
      }
      const response = await fetch(`${base}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, {
        headers: { authorization: `Bearer ${tokenBody.access_token}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw invalidProof();
      const purchase = await response.json() as {
        startTime?: string; subscriptionState?: string; linkedPurchaseToken?: string;
        lineItems?: Array<{ productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean } }>;
      };
      const item = purchase.lineItems?.find((line) => line.productId === proof.productId);
      if (!item || !purchase.startTime) throw invalidProof();
      const allowedState = ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"].includes(String(purchase.subscriptionState));
      const expiry = item.expiryTime ? Date.parse(item.expiryTime) : NaN;
      const expiresAt = allowedState && Number.isFinite(expiry) ? new Date(expiry).toISOString() : new Date(0).toISOString();
      const tokenHash = createHash("sha256").update(purchaseToken).digest("hex");
      return { platform: "android", productId: proof.productId, tier: plan, startedAt: new Date(purchase.startTime).toISOString(),
        expiresAt, autoRenew: item.autoRenewingPlan?.autoRenewEnabled ?? false, transactionId: tokenHash,
        originalTransactionId: `google:${tokenHash}` };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw unavailable();
    }
  }
}

function signServiceAccountJwt(clientEmail: string, privateKey: string, tokenUri: string, nowSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: clientEmail, scope: "https://www.googleapis.com/auth/androidpublisher", aud: tokenUri, iat: nowSeconds, exp: nowSeconds + 300 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}
