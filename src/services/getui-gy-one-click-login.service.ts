import { createDecipheriv, createHash } from "node:crypto";
import { ApplicationError, unauthorized } from "../shared/errors.ts";
import { maskSensitiveString } from "../shared/utils.ts";
import { CommonGetuiGyConfigService } from "./common-getui-gy-config.service.ts";

export interface GetuiGyPhoneResult {
  phone: string;
  providerResult: string;
  providerMessage: string;
  debug: {
    endpoint: string;
    appId: string;
    gyuidMasked: string;
    tokenMasked: string;
    providerRequest: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: Record<string, string | number>;
    };
  };
}

interface GetuiGyProviderEnvelope {
  errno?: number | string;
  data?: {
    result?: string;
    msg?: string;
    data?: {
      pn?: string;
      phone?: string;
    };
  };
}

export class GetuiGyOneClickLoginService {
  constructor(private readonly configService: CommonGetuiGyConfigService) {}

  async exchangeToken(command: {
    appId: string;
    token: string;
    gyuid: string;
  }): Promise<GetuiGyPhoneResult> {
    const config = await this.configService.getRuntimeConfig(command.appId);
    const token = command.token.trim();
    const gyuid = command.gyuid.trim();
    if (!token || !gyuid) {
      unauthorized(
        "AUTH_ONE_CLICK_TOKEN_INVALID",
        "One-click login token and gyuid are required.",
      );
    }

    const timestamp = Date.now();
    const body = {
      appId: config.appId,
      timestamp,
      gyuid,
      token,
      sign: sha256Hex(`${config.appKey}${timestamp}${config.masterSecret}`),
    };
    const providerRequest = {
      method: "POST",
      url: config.endpoint,
      headers: {
        "Content-Type": "application/json",
      },
      body,
    };

    let response: Response;
    try {
      response = await fetch(config.endpoint, {
        method: providerRequest.method,
        headers: providerRequest.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new ApplicationError(
        503,
        "ONE_CLICK_PROVIDER_REQUEST_FAILED",
        "Getui GeYan one-click login request failed.",
        {
          provider: "getui_gy",
          providerRequest,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    let payload: GetuiGyProviderEnvelope;
    try {
      payload = (await response.json()) as GetuiGyProviderEnvelope;
    } catch (error) {
      throw new ApplicationError(
        502,
        "ONE_CLICK_PROVIDER_REQUEST_FAILED",
        "Getui GeYan one-click login response is not valid JSON.",
        {
          provider: "getui_gy",
          providerRequest,
          statusCode: response.status,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const providerResult = payload.data?.result ?? "";
    const providerMessage = payload.data?.msg ?? "";
    if (
      !response.ok ||
      String(payload.errno ?? "") !== "0" ||
      providerResult !== "20000"
    ) {
      const code =
        providerResult === "40047" || providerResult === "40027"
          ? "AUTH_ONE_CLICK_TOKEN_INVALID"
          : "ONE_CLICK_PROVIDER_REQUEST_FAILED";
      throw new ApplicationError(
        code === "AUTH_ONE_CLICK_TOKEN_INVALID" ? 401 : 502,
        code,
        providerMessage ||
          "Getui GeYan one-click login provider rejected the token.",
        {
          provider: "getui_gy",
          providerRequest,
          statusCode: response.status,
          errno: payload.errno,
          result: providerResult,
          msg: providerMessage,
        },
      );
    }

    const encryptedPhone =
      payload.data?.data?.pn ?? payload.data?.data?.phone ?? "";
    if (!encryptedPhone) {
      throw new ApplicationError(
        502,
        "ONE_CLICK_PROVIDER_REQUEST_FAILED",
        "Getui GeYan one-click login response does not contain a phone number.",
        {
          provider: "getui_gy",
          providerRequest,
          result: providerResult,
          msg: providerMessage,
        },
      );
    }

    const phone = decryptPhone(encryptedPhone, config.masterSecret);
    if (!phone) {
      throw new ApplicationError(
        502,
        "ONE_CLICK_PROVIDER_REQUEST_FAILED",
        "Getui GeYan phone number could not be decrypted.",
        {
          provider: "getui_gy",
          providerRequest,
          result: providerResult,
          msg: providerMessage,
        },
      );
    }

    return {
      phone,
      providerResult,
      providerMessage,
      debug: {
        endpoint: config.endpoint,
        appId: config.appId,
        gyuidMasked: maskSensitiveString(gyuid),
        tokenMasked: maskSensitiveString(token),
        providerRequest,
      },
    };
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decryptPhone(encryptedPhone: string, masterSecret: string): string {
  if (/^\+?\d{8,20}$/.test(encryptedPhone)) {
    return encryptedPhone;
  }

  const key = buildAesKey(masterSecret);
  const iv = Buffer.from("0000000000000000", "utf8");
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(true);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedPhone, "hex")),
      decipher.final(),
    ])
      .toString("utf8")
      .trim();
    return /^\+?\d{8,20}$/.test(plaintext) ? plaintext : "";
  } catch {
    return "";
  }
}

function buildAesKey(masterSecret: string): Buffer {
  let key = masterSecret;
  while (key.length < 16) {
    key += masterSecret;
  }
  return Buffer.from(key.slice(0, 16), "utf8");
}
