import type { AlipayOptions } from "./alipay-models.ts";

/** Public provider identities belong to this product, not deployment secrets. */
export const AINOVEL_PAYMENT_IDENTITIES = {
  alipay: { production: "2021004120638042", sandbox: "9021000128686276" },
  revenueCat: { projectId: "33e4a275", appleAppId: "app1fb5f993e7", googleAppId: "appa62c7d1ce1" },
} as const;

const NOTIFY_ORIGINS: Record<string, string> = {
  online: "https://app.youwoai.net", production: "https://app.youwoai.net",
  dev: "https://app-dev.youwoai.net", development: "https://app-dev.youwoai.net",
};
const RETURN_URL = "https://orangewrite.cn/app/#/membership";

export function aiNovelAlipayRuntimeOptions(env: NodeJS.ProcessEnv = process.env): AlipayOptions {
  const mode = env.ALIPAY_AI_NOVEL_ENVIRONMENT;
  const environment = mode === "production" || mode === "sandbox" ? mode : undefined;
  const origin = NOTIFY_ORIGINS[env.DEPLOY_SLOT ?? env.APP_ENV ?? ""];
  return {
    environment,
    appId: environment ? AINOVEL_PAYMENT_IDENTITIES.alipay[environment] : undefined,
    privateKeyPath: env.ALIPAY_AI_NOVEL_PRIVATE_KEY_PATH,
    publicKeyPath: env.ALIPAY_AI_NOVEL_PUBLIC_KEY_PATH,
    notifyUrl: origin ? `${origin}/api/v1/ai_novel/billing/webhooks/alipay` : undefined,
    returnUrl: RETURN_URL,
  };
}
