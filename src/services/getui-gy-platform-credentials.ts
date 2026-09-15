import { ApplicationError } from "../shared/errors.ts";
import type { GetuiGyAppCredentials } from "../shared/types.ts";
import type { CommonPasswordConfigService } from "./common-password-config.service.ts";

export const AI_NOVEL_ZOOK_APP_ID = "ai_novel";
export const OHOS_SDK_PLATFORM = "ohos";
export const OHOS_GETUI_GY_APP_ID = "d8A7QwzcfUAdNzXh4jEje4";
export const OHOS_GETUI_GY_APP_KEY_PASSWORD_KEY = "getui.gy.ohos.app_key";
export const OHOS_GETUI_GY_APP_SECRET_PASSWORD_KEY =
  "getui.gy.ohos.app_secret";
export const OHOS_GETUI_GY_MASTER_SECRET_PASSWORD_KEY =
  "getui.gy.ohos.master_secret";

export async function resolveOhosGetuiGyCredentials(
  passwordConfigService: CommonPasswordConfigService,
): Promise<GetuiGyAppCredentials> {
  const passwordEntries = await Promise.all(
    [
      OHOS_GETUI_GY_APP_KEY_PASSWORD_KEY,
      OHOS_GETUI_GY_APP_SECRET_PASSWORD_KEY,
      OHOS_GETUI_GY_MASTER_SECRET_PASSWORD_KEY,
    ].map(async (key) => [key, await passwordConfigService.getValue(key)] as const),
  );
  const values = new Map(passwordEntries);
  const missingKeys = passwordEntries
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key);
  if (missingKeys.length > 0) {
    throw new ApplicationError(
      503,
      "ONE_CLICK_SERVICE_NOT_CONFIGURED",
      `OHOS Getui GeYan PASSWORD keys are not configured: ${missingKeys.join(", ")}.`,
    );
  }

  return {
    appId: OHOS_GETUI_GY_APP_ID,
    appKey: values.get(OHOS_GETUI_GY_APP_KEY_PASSWORD_KEY)!.trim(),
    appSecret: values.get(OHOS_GETUI_GY_APP_SECRET_PASSWORD_KEY)!.trim(),
    masterSecret: values.get(OHOS_GETUI_GY_MASTER_SECRET_PASSWORD_KEY)!.trim(),
  };
}
