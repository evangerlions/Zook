import { CommonPasswordConfigService } from "./services/common-password-config.service.ts";
import { TENCENT_SECRET_ID_PASSWORD_KEY, TENCENT_SECRET_KEY_PASSWORD_KEY } from "./services/common-email-config.service.ts";
import type { TencentCaptchaVerificationConfig } from "./services/tencent-captcha-verification.service.ts";
import type { TencentSmsVerificationConfig } from "./services/tencent-sms-verification.service.ts";
import type { CreateApplicationOptions } from "./application-options.ts";

export async function resolveTencentCloudCommonCredentials(
  commonPasswordConfigService: CommonPasswordConfigService,
): Promise<{ secretId?: string; secretKey?: string }> {
  const [secretId, secretKey] = await Promise.all([
    commonPasswordConfigService.getValue(TENCENT_SECRET_ID_PASSWORD_KEY),
    commonPasswordConfigService.getValue(TENCENT_SECRET_KEY_PASSWORD_KEY),
  ]);

  return {
    secretId,
    secretKey,
  };
}

export function resolveTencentSmsVerificationConfig(
  options: CreateApplicationOptions,
  credentials?: { secretId?: string; secretKey?: string },
): TencentSmsVerificationConfig {
  return {
    secretId:
      options.tencentSmsVerificationConfig?.secretId ??
      credentials?.secretId ??
      process.env.TENCENT_SMS_SECRET_ID ??
      process.env.TZ_SECRET_ID,
    secretKey:
      options.tencentSmsVerificationConfig?.secretKey ??
      credentials?.secretKey ??
      process.env.TENCENT_SMS_SECRET_KEY ??
      process.env.TZ_SECRET_KEY,
    sdkAppId:
      options.tencentSmsVerificationConfig?.sdkAppId ??
      process.env.TENCENT_SMS_SDK_APP_ID,
    templateId:
      options.tencentSmsVerificationConfig?.templateId ??
      process.env.TENCENT_SMS_TEMPLATE_ID,
    signName:
      options.tencentSmsVerificationConfig?.signName ??
      process.env.TENCENT_SMS_SIGN_NAME,
    region:
      options.tencentSmsVerificationConfig?.region ??
      process.env.TENCENT_SMS_REGION ??
      "ap-beijing",
  };
}

export function resolveTencentCaptchaVerificationConfig(
  options: CreateApplicationOptions,
  credentials?: { secretId?: string; secretKey?: string },
): TencentCaptchaVerificationConfig {
  const rawCaptchaAppId =
    options.tencentCaptchaVerificationConfig?.captchaAppId ??
    Number(process.env.TENCENT_CAPTCHA_APP_ID ?? "0");
  return {
    secretId:
      options.tencentCaptchaVerificationConfig?.secretId ??
      credentials?.secretId ??
      process.env.TENCENT_CAPTCHA_SECRET_ID ??
      process.env.TENCENT_SMS_SECRET_ID ??
      process.env.TZ_SECRET_ID,
    secretKey:
      options.tencentCaptchaVerificationConfig?.secretKey ??
      credentials?.secretKey ??
      process.env.TENCENT_CAPTCHA_SECRET_KEY ??
      process.env.TENCENT_SMS_SECRET_KEY ??
      process.env.TZ_SECRET_KEY,
    captchaAppId:
      Number.isInteger(rawCaptchaAppId) && rawCaptchaAppId > 0
        ? rawCaptchaAppId
        : undefined,
    appSecretKey:
      options.tencentCaptchaVerificationConfig?.appSecretKey ??
      process.env.TENCENT_CAPTCHA_APP_SECRET_KEY ??
      process.env.TZ_CAP_SECRET_KEY,
  };
}
