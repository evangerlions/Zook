import { existsSync } from "node:fs";
import { parseEnv } from "node:util";

export function applyLocalDefaults(env: NodeJS.ProcessEnv, contents: string): void {
  for (const [key, value] of Object.entries(parseEnv(contents))) {
    env[key] ??= value;
  }
}

/** Build an isolated local sandbox configuration without exposing credentials. */
export function applyAlipaySandboxConfig(env: NodeJS.ProcessEnv, contents: string): void {
  const config = parseEnv(contents);
  if (config.ALIPAY_AI_NOVEL_ENVIRONMENT !== "sandbox") {
    throw new Error("Alipay sandbox configuration must select the sandbox environment.");
  }
  for (const key of ["ALIPAY_AI_NOVEL_PRIVATE_KEY_PATH", "ALIPAY_AI_NOVEL_PUBLIC_KEY_PATH"] as const) {
    if (!config[key] || !existsSync(config[key])) throw new Error(`Alipay sandbox key file is missing: ${key}`);
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith("ALIPAY_AI_NOVEL_")) delete env[key];
  }
  for (const key of ["ALIPAY_AI_NOVEL_ENVIRONMENT", "ALIPAY_AI_NOVEL_PRIVATE_KEY_PATH", "ALIPAY_AI_NOVEL_PUBLIC_KEY_PATH"]) {
    env[key] = config[key];
  }
  env.APP_ENV = "local";
  env.PORT ||= "3193";
  env.HOST ||= "0.0.0.0";
  env.ZOOK_LOCAL_FILE_LOGS ||= "1";
}
