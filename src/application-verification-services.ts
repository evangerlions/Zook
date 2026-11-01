import type { KVManager } from "./infrastructure/kv/kv-manager.ts";
import { EmailTestSendService } from "./services/email-test-send.service.ts";
import type { CreateApplicationOptions } from "./application-options.ts";
import type { CommonEmailConfigService } from "./services/common-email-config.service.ts";
import type { CommonPasswordConfigService } from "./services/common-password-config.service.ts";
import type { CommonSmsConfigService } from "./services/common-sms-config.service.ts";
import { NoopCaptchaVerificationService, TencentCaptchaVerificationService } from "./services/tencent-captcha-verification.service.ts";
import { NoopRegistrationEmailSender, TencentSesRegistrationEmailSender } from "./services/tencent-ses-registration-email.service.ts";
import { NoopSmsVerificationSender, TencentSmsVerificationSender, type SmsVerificationSender } from "./services/tencent-sms-verification.service.ts";
import { resolveTencentCaptchaVerificationConfig, resolveTencentCloudCommonCredentials, resolveTencentSmsVerificationConfig } from "./tencent-cloud-runtime-config.ts";

export async function createApplicationVerificationServices({
  options,
  kvManager,
  commonPasswordConfigService,
  commonEmailConfigService,
  commonSmsConfigService,
}: {
  options: CreateApplicationOptions;
  kvManager: KVManager;
  commonPasswordConfigService: CommonPasswordConfigService;
  commonEmailConfigService: CommonEmailConfigService;
  commonSmsConfigService: CommonSmsConfigService;
}) {
  const tencentCloudCommonCredentials =
    await resolveTencentCloudCommonCredentials(commonPasswordConfigService);
  const baseTencentSmsVerificationConfig = resolveTencentSmsVerificationConfig(
    options,
    tencentCloudCommonCredentials,
  );
  const registrationEmailSender =
    options.registrationEmailSender ??
    (options.serviceName === "api" || options.serviceName === "worker"
      ? new TencentSesRegistrationEmailSender(commonEmailConfigService)
      : new NoopRegistrationEmailSender());
  const smsVerificationSender =
    options.smsVerificationSender ??
    (options.serviceName === "api"
      ? ({
          async sendVerificationCode(command) {
            const config = await commonSmsConfigService.getRuntimeConfig(
              baseTencentSmsVerificationConfig,
            );
            return new TencentSmsVerificationSender(
              config,
            ).sendVerificationCode(command);
          },
        } satisfies SmsVerificationSender)
      : new NoopSmsVerificationSender());
  const captchaVerificationService =
    options.captchaVerificationService ??
    (options.serviceName === "api"
      ? new TencentCaptchaVerificationService(
          resolveTencentCaptchaVerificationConfig(
            options,
            tencentCloudCommonCredentials,
          ),
        )
      : new NoopCaptchaVerificationService());
  const emailTestSendService = new EmailTestSendService(
    commonEmailConfigService,
    kvManager,
    registrationEmailSender,
  );
  return { registrationEmailSender, smsVerificationSender, captchaVerificationService, emailTestSendService };
}
