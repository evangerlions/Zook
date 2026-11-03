import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AlipayEnvironmentOptions } from "./alipay-models.ts";
import { billingDeploymentEnvironment, billingEnvironments } from "./billing-environment.ts";

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

/** Fixed Secret layout; no merchant selector or key-path env variables. */
export function aiNovelAlipayRuntimeOptions(env: NodeJS.ProcessEnv = process.env, secretsRoot?: string): AlipayEnvironmentOptions {
  const deployment = billingDeploymentEnvironment(env);
  const root = secretsRoot ?? (["local", "test"].includes(deployment)
    ? join(homedir(), ".zook/secrets/ainovel-alipay") : "/run/secrets/ainovel-alipay");
  const origin = NOTIFY_ORIGINS[deployment];
  return Object.fromEntries(billingEnvironments(deployment).map(environment => {
    const privateKeyPath = join(root, environment, "app-private-key.pem");
    const publicKeyPath = join(root, environment, "alipay-public-key.pem");
    try {
      if (!statSync(privateKeyPath).isFile() || !statSync(publicKeyPath).isFile()) return [environment, {}];
      accessSync(privateKeyPath, constants.R_OK);
      accessSync(publicKeyPath, constants.R_OK);
    } catch { return [environment, {}]; }
    return [environment, {
      appId: AINOVEL_PAYMENT_IDENTITIES.alipay[environment], privateKeyPath, publicKeyPath,
      notifyUrl: origin ? `${origin}/api/v1/ai_novel/billing/webhooks/alipay` : undefined,
      returnUrl: RETURN_URL,
    }];
  }));
}
