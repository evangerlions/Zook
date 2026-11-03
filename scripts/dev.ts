import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyAlipaySandboxConfig, applyLocalDefaults } from "./alipay-sandbox-config.ts";

if (process.argv.includes("--alipay-sandbox")) {
  const localDefaults = "deploy_configs/local.env";
  if (existsSync(localDefaults)) applyLocalDefaults(process.env, readFileSync(localDefaults, "utf8"));
  const configPath = join(homedir(), ".zook", "alipay", "chat-sandbox", "sandbox-test.env");
  let contents: string;
  try {
    contents = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`Alipay sandbox configuration file is unavailable: ${configPath}`);
  }
  applyAlipaySandboxConfig(process.env, contents);
  if (process.argv.includes("--check")) {
    console.log("Alipay sandbox configuration is ready for local startup.");
  } else {
    await import("../src/main.ts");
  }
} else {
  await import("../src/main.ts");
}
