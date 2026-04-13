import { ApplicationError } from "../shared/errors.ts";
import {
  sendTencentCloudJsonRequest,
  type TencentCloudCredentials,
  type TencentCloudRequestDebug,
} from "./tencent-cloud-request.ts";

export interface TencentCaptchaVerificationConfig {
  secretId?: string;
  secretKey?: string;
  captchaAppId?: number;
  appSecretKey?: string;
}

export interface CaptchaVerificationResult {
  provider: "tencent_captcha";
  success: boolean;
  requestId?: string;
  captchaCode?: number;
  message?: string | null;
  debug?: TencentCloudRequestDebug;
}

export interface CaptchaVerificationService {
  verifyCaptcha(command: {
    ticket: string;
    userIp: string;
    randstr: string;
  }): Promise<CaptchaVerificationResult>;
}

export class NoopCaptchaVerificationService implements CaptchaVerificationService {
  async verifyCaptcha(): Promise<CaptchaVerificationResult> {
    return {
      provider: "tencent_captcha",
      success: false,
      message: "Captcha verification service is not configured.",
    };
  }
}

interface TencentCaptchaDescribeResponse {
  Response?: {
    RequestId?: string;
    CaptchaCode?: number;
    CaptchaMsg?: string;
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
}

export class TencentCaptchaVerificationService implements CaptchaVerificationService {
  constructor(
    private readonly config: TencentCaptchaVerificationConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async verifyCaptcha(command: {
    ticket: string;
    userIp: string;
    randstr: string;
  }): Promise<CaptchaVerificationResult> {
    const credentials = this.resolveCredentials();
    const captchaAppId = this.config.captchaAppId;
    const appSecretKey = this.requiredConfig(this.config.appSecretKey, "Tencent captcha app secret key");

    if (!Number.isInteger(captchaAppId) || (captchaAppId ?? 0) <= 0) {
      throw new ApplicationError(503, "CAPTCHA_SERVICE_NOT_CONFIGURED", "Tencent captcha appId is not configured.");
    }

    const body = {
      CaptchaType: 9,
      Ticket: command.ticket,
      UserIp: command.userIp,
      Randstr: command.randstr,
      CaptchaAppId: captchaAppId,
      AppSecretKey: appSecretKey,
    };

    const { payload, debug } = await sendTencentCloudJsonRequest<TencentCaptchaDescribeResponse>({
      action: "DescribeCaptchaResult",
      service: "captcha",
      version: "2019-07-22",
      host: "captcha.tencentcloudapi.com",
      credentials,
      body,
    }, this.fetchImplementation);

    if (payload.Response?.Error) {
      throw new ApplicationError(
        502,
        "CAPTCHA_PROVIDER_REQUEST_FAILED",
        `${payload.Response.Error.Code ?? "CaptchaProviderRequestFailed"}: ${payload.Response.Error.Message ?? "Tencent captcha request failed."}`,
        {
          provider: "tencent_captcha",
          requestId: payload.Response.RequestId,
          debug,
        },
      );
    }

    const captchaCode = payload.Response?.CaptchaCode;
    const success = captchaCode === 1;
    return {
      provider: "tencent_captcha",
      success,
      requestId: payload.Response?.RequestId,
      captchaCode,
      message: success ? null : payload.Response?.CaptchaMsg ?? "captcha internal error",
      debug,
    };
  }

  private resolveCredentials(): TencentCloudCredentials {
    const secretId = this.requiredConfig(this.config.secretId, "Tencent captcha secretId");
    const secretKey = this.requiredConfig(this.config.secretKey, "Tencent captcha secretKey");
    return { secretId, secretKey };
  }

  private requiredConfig(value: string | undefined, label: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new ApplicationError(503, "CAPTCHA_SERVICE_NOT_CONFIGURED", `${label} is not configured.`);
    }

    return normalized;
  }
}
