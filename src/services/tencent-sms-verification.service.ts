import { ApplicationError } from "../shared/errors.ts";
import {
  sendTencentCloudJsonRequest,
  type TencentCloudCredentials,
  type TencentCloudRequestDebug,
} from "./tencent-cloud-request.ts";

export interface TencentSmsVerificationConfig {
  secretId?: string;
  secretKey?: string;
  sdkAppId?: string;
  templateId?: string;
  signName?: string;
  region?: string;
}

export interface SmsVerificationSendResult {
  provider: "tencent_sms";
  requestId?: string;
  sendSerialNo?: string;
  phoneNumber: string;
  debug?: TencentCloudRequestDebug;
}

export interface SmsVerificationSender {
  sendVerificationCode(command: {
    phoneNumber: string;
    code: string;
    expireMinutes: number;
  }): Promise<SmsVerificationSendResult>;
}

export class NoopSmsVerificationSender implements SmsVerificationSender {
  async sendVerificationCode(command: {
    phoneNumber: string;
    code: string;
    expireMinutes: number;
  }): Promise<SmsVerificationSendResult> {
    return {
      provider: "tencent_sms",
      phoneNumber: command.phoneNumber,
    };
  }
}

interface TencentSmsSendResponse {
  Response?: {
    RequestId?: string;
    SendStatusSet?: Array<{
      SerialNo?: string;
      PhoneNumber?: string;
      Fee?: number;
      SessionContext?: string;
      Code?: string;
      Message?: string;
      IsoCode?: string;
    }>;
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
}

export class TencentSmsVerificationSender implements SmsVerificationSender {
  constructor(
    private readonly config: TencentSmsVerificationConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async sendVerificationCode(command: {
    phoneNumber: string;
    code: string;
    expireMinutes: number;
  }): Promise<SmsVerificationSendResult> {
    const credentials = this.resolveCredentials();
    const sdkAppId = this.requiredConfig(this.config.sdkAppId, "Tencent SMS SDK App ID");
    const templateId = this.requiredConfig(this.config.templateId, "Tencent SMS template ID");
    const signName = this.requiredConfig(this.config.signName, "Tencent SMS sign name");
    const region = (this.config.region?.trim() || "ap-beijing");

    const body = {
      PhoneNumberSet: [command.phoneNumber],
      SmsSdkAppId: sdkAppId,
      TemplateId: templateId,
      SignName: signName,
      TemplateParamSet: [command.code, String(command.expireMinutes)],
    };

    const { payload, debug } = await sendTencentCloudJsonRequest<TencentSmsSendResponse>({
      action: "SendSms",
      service: "sms",
      version: "2021-01-11",
      host: "sms.tencentcloudapi.com",
      region,
      credentials,
      body,
    }, this.fetchImplementation);

    if (payload.Response?.Error) {
      throw new ApplicationError(
        502,
        "SMS_PROVIDER_REQUEST_FAILED",
        `${payload.Response.Error.Code ?? "SmsProviderRequestFailed"}: ${payload.Response.Error.Message ?? "Tencent SMS request failed."}`,
        {
          provider: "tencent_sms",
          requestId: payload.Response.RequestId,
          debug,
        },
      );
    }

    const status = payload.Response?.SendStatusSet?.[0];
    if (!status) {
      throw new ApplicationError(502, "SMS_PROVIDER_REQUEST_FAILED", "Tencent SMS response is missing send status.", {
        provider: "tencent_sms",
        requestId: payload.Response?.RequestId,
        debug,
      });
    }

    if (status.Code !== "Ok") {
      throw new ApplicationError(
        502,
        "SMS_PROVIDER_REQUEST_FAILED",
        `${status.Code ?? "SmsSendFailed"}: ${status.Message ?? "Tencent SMS returned a non-success send status."}`,
        {
          provider: "tencent_sms",
          requestId: payload.Response?.RequestId,
          debug,
          sendStatus: status,
        },
      );
    }

    return {
      provider: "tencent_sms",
      requestId: payload.Response?.RequestId,
      sendSerialNo: status.SerialNo,
      phoneNumber: command.phoneNumber,
      debug,
    };
  }

  private resolveCredentials(): TencentCloudCredentials {
    const secretId = this.requiredConfig(this.config.secretId, "Tencent SMS secretId");
    const secretKey = this.requiredConfig(this.config.secretKey, "Tencent SMS secretKey");
    return { secretId, secretKey };
  }

  private requiredConfig(value: string | undefined, label: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new ApplicationError(503, "SMS_SERVICE_NOT_CONFIGURED", `${label} is not configured.`);
    }

    return normalized;
  }
}
