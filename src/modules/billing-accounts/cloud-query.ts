import { createHash, createHmac, randomUUID } from "node:crypto";
import { signVolcOpenApi } from "./volc-openapi-signature.ts";
import type { BalanceSample } from "../llm-balances/balance-models.ts";
import type { AccountType } from "./account-store.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export function cloudRequest(type: AccountType, accessKey: string, secretKey: string, now = new Date()): [string, RequestInit] {
  const day = now.toISOString().slice(0, 10);
  if (type === "aliyun") {
    const p: Record<string, string> = { Action: "QueryAccountBalance", Version: "2017-12-14", Format: "JSON", AccessKeyId: accessKey,
      SignatureMethod: "HMAC-SHA1", SignatureVersion: "1.0", SignatureNonce: randomUUID(), Timestamp: now.toISOString().replace(/\.\d{3}Z$/, "Z") };
    const query = Object.keys(p).sort().map(k => `${enc(k)}=${enc(p[k])}`).join("&");
    const sig = createHmac("sha1", `${secretKey}&`).update(`GET&%2F&${enc(query)}`).digest("base64");
    return [`https://business.aliyuncs.com/?${query}&Signature=${enc(sig)}`, { method: "GET" }];
  }
  if (type === "tencent") {
    const host = "billing.tencentcloudapi.com", body = "{}", signed = "content-type;host";
    const canonical = `POST\n/\n\ncontent-type:application/json\nhost:${host}\n\n${signed}\n${hash(body)}`;
    const scope = `${day}/billing/tc3_request`, stamp = Math.floor(now.getTime() / 1000);
    const key = hmac(hmac(hmac(`TC3${secretKey}`, day), "billing"), "tc3_request");
    const signature = hmac(key, `TC3-HMAC-SHA256\n${stamp}\n${scope}\n${hash(canonical)}`).toString("hex");
    return [`https://${host}/`, { method: "POST", body, headers: { "Content-Type": "application/json", "X-TC-Action": "DescribeAccountBalance",
      "X-TC-Version": "2018-07-09", "X-TC-Timestamp": String(stamp), Authorization: `TC3-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}` } }];
  }
  if (type !== "volcengine") throw new Error("Unknown cloud account type");
  return signVolcOpenApi({ host: "billing.volcengineapi.com", region: "cn-north-1", service: "billing",
    query: "Action=QueryBalanceAcct&Version=2022-01-01", method: "GET" }, accessKey, secretKey, now);
}
export function parseCloudBalance(type: AccountType, body: any): BalanceSample {
  let value: unknown;
  if (type === "aliyun") { if (body.Success !== true || !body.Data) throw new Error("Rejected balance response"); value = body.Data.AvailableAmount; }
  else if (type === "tencent") { if (body.Response?.Error) throw new Error("Rejected balance response"); value = body.Response?.RealBalance; }
  else if (type === "volcengine") { if (body.ResponseMetadata?.Error) throw new Error("Rejected balance response"); value = body.Result?.AvailableBalance; }
  else throw new Error("Unknown cloud account type");
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value.replace(/,/g, "")))) throw new Error("Missing balance");
  const amount = Number(typeof value === "string" ? value.replace(/,/g, "") : value);
  if (!Number.isFinite(amount)) throw new Error("Invalid balance");
  const unit = type === "aliyun" ? body.Data.Currency : "CNY";
  if (unit !== "CNY" && unit !== "USD") throw new Error("Unsupported currency");
  return { status: "ok", metrics: [{ kind: "account_balance", scope: "account", remaining: type === "tencent" ? amount / 100 : amount, unit }] };
}
export async function queryCloudBalance(type: AccountType, credential: string | undefined, fetcher: typeof fetch): Promise<BalanceSample> {
  if (!credential) return { status: "unconfigured", metrics: [] };
  try {
    const { accessKey, secretKey } = JSON.parse(credential);
    if (typeof accessKey !== "string" || !accessKey || typeof secretKey !== "string" || !secretKey) return { status: "unconfigured", metrics: [] };
    const [url, options] = cloudRequest(type, accessKey, secretKey);
    const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (response.status === 401 || response.status === 403) return { status: "unauthorized", metrics: [] };
    if (!response.ok) return { status: "error", metrics: [], detail: `Balance endpoint returned HTTP ${response.status}.` };
    return parseCloudBalance(type, await response.json());
  } catch { return { status: "error", metrics: [], detail: "Cloud balance query failed. Check account credentials and permissions." }; }
}
