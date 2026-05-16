import { createHash, createHmac } from "node:crypto";

export interface TencentCloudCredentials {
  secretId: string;
  secretKey: string;
}

export interface TencentCloudRequestCommand {
  action: string;
  service: string;
  version: string;
  host: string;
  region?: string;
  credentials: TencentCloudCredentials;
  body: Record<string, unknown>;
}

export interface TencentCloudRequestDebug {
  request: {
    endpoint: string;
    method: "POST";
    headers: Record<string, string>;
    body: Record<string, unknown>;
    credentials: {
      secretIdMasked: string;
      secretKeyMasked: string;
    };
  };
  response: {
    statusCode: number;
    ok: boolean;
    body: unknown;
    requestId?: string;
    errorCode?: string;
    errorMessage?: string;
  };
}

export interface TencentCloudApiResponseEnvelope {
  Response?: {
    RequestId?: string;
    Error?: {
      Code?: string;
      Message?: string;
    };
    [key: string]: unknown;
  };
}

export async function sendTencentCloudJsonRequest<TResponse extends TencentCloudApiResponseEnvelope>(
  command: TencentCloudRequestCommand,
  fetchImplementation: typeof fetch = fetch,
): Promise<{ payload: TResponse; debug: TencentCloudRequestDebug }> {
  const contentType = "application/json; charset=utf-8";
  const method = "POST";
  const body = JSON.stringify(command.body);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:${contentType}\nhost:${command.host}\nx-tc-action:${command.action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const hashedRequestPayload = sha256Hex(body);
  const canonicalRequest = `${method}\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;
  const credentialScope = `${date}/${command.service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const secretDate = hmacSha256(Buffer.from(`TC3${command.credentials.secretKey}`, "utf8"), date);
  const secretService = hmacSha256(secretDate, command.service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256(secretSigning, stringToSign, "hex");
  const authorization =
    `TC3-HMAC-SHA256 Credential=${command.credentials.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Type": contentType,
    Host: command.host,
    "X-TC-Action": command.action,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": command.version,
  };

  if (command.region) {
    headers["X-TC-Region"] = command.region;
  }

  const response = await fetchImplementation(`https://${command.host}/`, {
    method,
    headers,
    body,
  });
  const payload = (await response.json()) as TResponse;

  return {
    payload,
    debug: {
      request: {
        endpoint: `https://${command.host}/`,
        method,
        headers: {
          "Content-Type": contentType,
          Host: command.host,
          "X-TC-Action": command.action,
          "X-TC-Timestamp": String(timestamp),
          "X-TC-Version": command.version,
          ...(command.region ? { "X-TC-Region": command.region } : {}),
        },
        body: command.body,
        credentials: {
          secretIdMasked: maskSensitiveString(command.credentials.secretId),
          secretKeyMasked: maskSensitiveString(command.credentials.secretKey),
        },
      },
      response: {
        statusCode: response.status,
        ok: response.ok,
        body: payload,
        requestId: payload.Response?.RequestId,
        errorCode: payload.Response?.Error?.Code,
        errorMessage: payload.Response?.Error?.Message,
      },
    },
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, value: string, encoding?: "hex"): Buffer | string {
  const hmac = createHmac("sha256", key).update(value, "utf8");
  return encoding ? hmac.digest(encoding) : hmac.digest();
}

function maskSensitiveString(value: string): string {
  if (!value) {
    return "";
  }

  if (value.length <= 6) {
    return `${value[0] ?? ""}***${value.at(-1) ?? ""}`;
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}
