import { createHash, createHmac, randomUUID } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import { maskSensitiveString } from "../shared/utils.ts";

export interface AliyunContentSafetyCredentials {
  accessKeyId: string;
  accessKeySecret: string;
}

export interface AliyunContentSafetyCommand {
  endpoint: string;
  region: string;
  service: string;
  credentials: AliyunContentSafetyCredentials;
  text: string;
  timeoutMs: number;
}

export interface AliyunContentSafetyResult {
  blocked: boolean;
  category?: string;
  providerRequestId?: string;
  rawDecision?: unknown;
}

interface AliyunTextModerationPlusResponse {
  RequestId?: string;
  Code?: number | string;
  Message?: string;
  Data?: {
    RiskLevel?: string;
    Result?: Array<{
      Label?: string;
      Confidence?: number;
      RiskWords?: string;
      Description?: string;
      CustomizedHit?: Array<{
        LibName?: string;
        KeyWords?: string;
      }>;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function sendAliyunTextModerationRequest(
  command: AliyunContentSafetyCommand,
  fetchImplementation: typeof fetch = fetch,
): Promise<AliyunContentSafetyResult> {
  const body = JSON.stringify({
    Service: command.service,
    ServiceParameters: JSON.stringify({
      content: command.text,
      dataId: randomUUID(),
    }),
  });
  const endpoint = new URL(command.endpoint);
  const host = endpoint.host;
  const action = "TextModerationPlus";
  const version = "2022-03-02";
  const method = "POST";
  const now = new Date();
  const contentSha256 = sha256Hex(body);
  const nonce = randomUUID();
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    host,
    "x-acs-action": action,
    "x-acs-content-sha256": contentSha256,
    "x-acs-date": now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    "x-acs-region-id": command.region,
    "x-acs-signature-nonce": nonce,
    "x-acs-version": version,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((key) => `${key}:${headers[key]}`).join("\n") + "\n";
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    contentSha256,
  ].join("\n");
  const stringToSign = `ACS3-HMAC-SHA256\n${sha256Hex(canonicalRequest)}`;
  const signature = createHmac("sha256", command.credentials.accessKeySecret)
    .update(stringToSign, "utf8")
    .digest("hex");
  headers.authorization =
    `ACS3-HMAC-SHA256 Credential=${command.credentials.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), command.timeoutMs);
  let response: Response;
  try {
    response = await fetchImplementation(command.endpoint, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const rawBody = await response.text();
  let payload: AliyunTextModerationPlusResponse;
  try {
    payload = rawBody ? JSON.parse(rawBody) as AliyunTextModerationPlusResponse : {};
  } catch {
    throw new ApplicationError(
      502,
      "AI_UPSTREAM_BAD_GATEWAY",
      "Aliyun content safety response is not valid JSON.",
      {
        provider: "aliyun_content_safety",
        statusCode: response.status,
      },
    );
  }

  if (!response.ok || (payload.Code !== undefined && String(payload.Code) !== "200")) {
    throw new ApplicationError(
      502,
      "AI_UPSTREAM_BAD_GATEWAY",
      payload.Message || "Aliyun content safety request failed.",
      {
        provider: "aliyun_content_safety",
        statusCode: response.status,
        requestId: payload.RequestId,
        code: payload.Code,
        credentials: {
          accessKeyIdMasked: maskSensitiveString(command.credentials.accessKeyId),
          accessKeySecretMasked: maskSensitiveString(command.credentials.accessKeySecret),
        },
      },
    );
  }

  const riskLevel = String(payload.Data?.RiskLevel ?? "").toLowerCase();
  const result = payload.Data?.Result?.[0];
  return {
    blocked: riskLevel === "high" || riskLevel === "medium",
    category: result?.Label,
    providerRequestId: payload.RequestId,
    rawDecision: {
      riskLevel: payload.Data?.RiskLevel,
      label: result?.Label,
      confidence: result?.Confidence,
    },
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
