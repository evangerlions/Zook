import { createHash, createHmac } from "node:crypto";

interface VolcRequest {
  host: string;
  region: string;
  service: string;
  query: string;
  method: "GET" | "POST";
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();

export function signVolcOpenApi(request: VolcRequest, accessKey: string, secretKey: string, now = new Date()): [string, RequestInit] {
  const { host, query, region, service, method } = request;
  const body = method === "POST" ? "{}" : undefined;
  const date = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const day = date.slice(0, 8);
  const payloadHash = hash(body ?? "");
  const headers: Record<string, string> = {
    ...(body ? { "content-type": "application/json" } : {}),
    host,
    "x-content-sha256": payloadHash,
    "x-date": date,
  };
  const signed = Object.keys(headers).join(";");
  const canonicalHeaders = Object.entries(headers).map(([key, value]) => `${key}:${value}\n`).join("");
  const canonical = [method, "/", query, canonicalHeaders, signed, payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/request`;
  const key = hmac(hmac(hmac(hmac(secretKey, day), region), service), "request");
  const signature = hmac(key, `HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString("hex");
  const Authorization = `HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  // fetch supplies the URL host. The signature still includes it.
  const { host: _host, ...sentHeaders } = headers;
  return [`https://${host}/?${query}`, { method, body, headers: { ...sentHeaders, Authorization } }];
}
