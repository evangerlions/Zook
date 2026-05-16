import { createHash, createHmac } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import { maskSensitiveString } from "../shared/utils.ts";
import { CommonEmailConfigService } from "./common-email-config.service.ts";
import type { TencentSesRegion } from "../shared/types.ts";

export interface TemplateEmailSendResult {
  provider: "tencent_ses";
  requestId?: string;
  messageId?: string;
  debug?: {
    request: {
      endpoint: string;
      method: "POST";
      clientRegion: TencentSesRegion;
      resolvedRegion: TencentSesRegion;
      headers: Record<string, string>;
      credentials: {
        secretIdMasked: string;
        secretKeyMasked: string;
      };
      body: Record<string, unknown>;
    };
    response?: {
      statusCode: number;
      ok: boolean;
      body: unknown;
      requestId?: string;
      messageId?: string;
      errorCode?: string;
      errorMessage?: string;
    };
  };
}

export interface VerificationEmailSender {
  sendTemplateEmail(command: {
    email: string;
    clientRegion: TencentSesRegion;
    region: TencentSesRegion;
    fromEmailAddress: string;
    subject: string;
    templateId: number;
    templateData: Record<string, unknown>;
  }): Promise<TemplateEmailSendResult>;
  sendVerificationCode(command: {
    appName: string;
    email: string;
    code: string;
    locale: string;
    region: TencentSesRegion;
    expireMinutes: number;
    templateName?: string;
  }): Promise<TemplateEmailSendResult>;
}

export type RegistrationEmailSender = VerificationEmailSender;

export class NoopRegistrationEmailSender implements VerificationEmailSender {
  async sendTemplateEmail(): Promise<TemplateEmailSendResult> {
    return {
      provider: "tencent_ses",
    };
  }

  async sendVerificationCode(): Promise<TemplateEmailSendResult> {
    return {
      provider: "tencent_ses",
    };
  }
}

export class TencentSesRegistrationEmailSender implements VerificationEmailSender {
  constructor(private readonly commonEmailConfigService: CommonEmailConfigService) {}

  async sendTemplateEmail(command: {
    email: string;
    clientRegion: TencentSesRegion;
    region: TencentSesRegion;
    fromEmailAddress: string;
    subject: string;
    templateId: number;
    templateData: Record<string, unknown>;
  }): Promise<TemplateEmailSendResult> {
    return this.sendTencentTemplateEmail({
      email: command.email,
      clientRegion: command.clientRegion,
      region: command.region,
      fromEmailAddress: command.fromEmailAddress,
      subject: command.subject,
      templateId: command.templateId,
      templateData: command.templateData,
    });
  }

  async sendVerificationCode(command: {
    appName: string;
    email: string;
    code: string;
    locale: string;
    region: TencentSesRegion;
    expireMinutes: number;
    templateName?: string;
  }): Promise<TemplateEmailSendResult> {
    const { resolvedRegion, secretId, secretKey, sender, template } = await this.commonEmailConfigService.getRuntimeConfig(
      command.locale,
      command.region,
      command.templateName,
    );
    return this.sendTencentTemplateEmail({
      email: command.email,
      clientRegion: command.region,
      region: resolvedRegion,
      fromEmailAddress: sender.address,
      subject: template.subject,
      templateId: template.templateId,
      templateData: {
        appName: command.appName,
        expireMinutes: command.expireMinutes,
        code: command.code,
      },
      secretId,
      secretKey,
    });
  }

  private async sendTencentTemplateEmail(command: {
    email: string;
    clientRegion: TencentSesRegion;
    region: TencentSesRegion;
    fromEmailAddress: string;
    subject: string;
    templateId: number;
    templateData: Record<string, unknown>;
    secretId?: string;
    secretKey?: string;
  }): Promise<TemplateEmailSendResult> {
    const credentials = command.secretId && command.secretKey
      ? {
          secretId: command.secretId,
          secretKey: command.secretKey,
        }
      : await this.commonEmailConfigService.getRuntimeConfigByTemplateId(command.templateId, command.region)
        .then((runtime) => ({
          secretId: runtime.secretId,
          secretKey: runtime.secretKey,
        }));
    const { secretId, secretKey } = credentials;
    const host = "ses.tencentcloudapi.com";
    const service = "ses";
    const action = "SendEmail";
    const version = "2020-10-02";
    const body = JSON.stringify({
      FromEmailAddress: command.fromEmailAddress,
      Destination: [command.email],
      Subject: command.subject,
      Template: {
        TemplateID: command.templateId,
        TemplateData: JSON.stringify(command.templateData),
      },
      TriggerType: 1,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const contentType = "application/json; charset=utf-8";
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
    const signedHeaders = "content-type;host;x-tc-action";
    const hashedRequestPayload = sha256Hex(body);
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
    const secretDate = hmacSha256(Buffer.from(`TC3${secretKey}`, "utf8"), date);
    const secretService = hmacSha256(secretDate, service);
    const secretSigning = hmacSha256(secretService, "tc3_request");
    const signature = hmacSha256(secretSigning, stringToSign, "hex");
    const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const debugRequest = {
      endpoint: `https://${host}/`,
      method: "POST" as const,
      clientRegion: command.clientRegion,
      resolvedRegion: command.region,
      headers: {
        "Content-Type": contentType,
        Host: host,
        "X-TC-Action": action,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": version,
        "X-TC-Region": command.region,
      },
      credentials: {
        secretIdMasked: maskSensitiveString(secretId),
        secretKeyMasked: maskSensitiveString(secretKey),
      },
      body: {
        FromEmailAddress: command.fromEmailAddress,
        Destination: [command.email],
        Subject: command.subject,
        Template: {
          TemplateID: command.templateId,
          TemplateData: JSON.stringify(command.templateData),
        },
        TriggerType: 1,
      },
    };

    const response = await fetch(`https://${host}/`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": contentType,
        Host: host,
        "X-TC-Action": action,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": version,
        "X-TC-Region": command.region,
      },
      body,
    });

    const payload = (await response.json()) as {
      Response?: {
        RequestId?: string;
        MessageId?: string;
        Error?: {
          Code?: string;
          Message?: string;
        };
      };
    };
    const debugResponse = {
      statusCode: response.status,
      ok: response.ok,
      body: payload,
      requestId: payload.Response?.RequestId,
      messageId: payload.Response?.MessageId,
      errorCode: payload.Response?.Error?.Code,
      errorMessage: payload.Response?.Error?.Message,
    };

    if (!response.ok || payload.Response?.Error) {
      const errorCode = payload.Response?.Error?.Code ?? "EmailProviderRequestFailed";
      const errorMessage = payload.Response?.Error?.Message ?? `Tencent SES request failed with status ${response.status}.`;
      throw new ApplicationError(502, "EMAIL_PROVIDER_REQUEST_FAILED", `${errorCode}: ${errorMessage}`, {
        requestId: payload.Response?.RequestId,
        provider: "tencent_ses",
        debug: {
          request: debugRequest,
          response: debugResponse,
        },
      });
    }

    return {
      provider: "tencent_ses",
      requestId: payload.Response?.RequestId,
      messageId: payload.Response?.MessageId,
      debug: {
        request: debugRequest,
        response: debugResponse,
      },
    };
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, value: string, encoding?: "hex"): Buffer | string {
  const hmac = createHmac("sha256", key).update(value, "utf8");
  return encoding ? hmac.digest(encoding) : hmac.digest();
}
