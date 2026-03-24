import { createHash, createHmac } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import { CommonEmailConfigService } from "./common-email-config.service.ts";

export interface RegistrationEmailSender {
  sendRegistrationCode(command: {
    appId: string;
    email: string;
    code: string;
    locale: string;
    senderId: string;
    replyToAddresses?: string;
    subject: string;
  }): Promise<void>;
}

export class NoopRegistrationEmailSender implements RegistrationEmailSender {
  async sendRegistrationCode(): Promise<void> {}
}

export class TencentSesRegistrationEmailSender implements RegistrationEmailSender {
  constructor(private readonly commonEmailConfigService: CommonEmailConfigService) {}

  async sendRegistrationCode(command: {
    appId: string;
    email: string;
    code: string;
    locale: string;
    senderId: string;
    replyToAddresses?: string;
    subject: string;
  }): Promise<void> {
    const { resolvedRegion, secretId, secretKey, sender, template } = await this.commonEmailConfigService.getRuntimeConfig(
      command.locale,
      command.senderId,
    );
    const host = "ses.tencentcloudapi.com";
    const service = "ses";
    const action = "SendEmail";
    const version = "2020-10-02";
    const body = JSON.stringify({
      FromEmailAddress: sender.address,
      ReplyToAddresses: command.replyToAddresses || undefined,
      Destination: [command.email],
      Subject: command.subject,
      Template: {
        TemplateID: template.templateId,
        TemplateData: JSON.stringify({
          code: command.code,
          appId: command.appId,
          email: command.email,
        }),
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

    const response = await fetch(`https://${host}/`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": contentType,
        Host: host,
        "X-TC-Action": action,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": version,
        "X-TC-Region": resolvedRegion,
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

    if (!response.ok || payload.Response?.Error) {
      const errorCode = payload.Response?.Error?.Code ?? "EmailProviderRequestFailed";
      const errorMessage = payload.Response?.Error?.Message ?? `Tencent SES request failed with status ${response.status}.`;
      throw new ApplicationError(502, "EMAIL_PROVIDER_REQUEST_FAILED", `${errorCode}: ${errorMessage}`, {
        requestId: payload.Response?.RequestId,
        provider: "tencent_ses",
      });
    }
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, value: string, encoding?: "hex"): Buffer | string {
  const hmac = createHmac("sha256", key).update(value, "utf8");
  return encoding ? hmac.digest(encoding) : hmac.digest();
}
