import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BalanceSample } from "../llm-balances/balance-models.ts";

const run = promisify(execFile);
const resolvePackage = createRequire(import.meta.url).resolve;
interface AccessKeys { accessKey: string; secretKey: string }

export function parseBailianAccessKeys(value: string | undefined): AccessKeys | undefined {
  if (!value) return;
  try {
    const { accessKey, secretKey } = JSON.parse(value);
    if (typeof accessKey !== "string" || !/^\S+$/.test(accessKey) ||
        typeof secretKey !== "string" || !/^\S+$/.test(secretKey)) return;
    return { accessKey, secretKey };
  } catch { return; }
}

export function parseBailianTokenPlanQuota(output: string): BalanceSample {
  const data = JSON.parse(output);
  const used = data?.per1MonthPercentage;
  if (data?.hasQuotaData !== true || typeof used !== "number" ||
      !Number.isFinite(used) || used < 0 || used > 1) {
    return { status: "error", metrics: [], detail: "Bailian CLI returned no valid monthly quota." };
  }
  const resetTime = data.per1MonthResetTime;
  const resetAt = Number.isSafeInteger(resetTime) && resetTime > 0 && resetTime <= 8.64e15
    ? new Date(resetTime).toISOString() : undefined;
  return { status: "ok", metrics: [{
    kind: "token_plan_monthly_remaining", scope: "personal", remaining: (1 - used) * 100,
    unit: "%", ...(resetAt ? { resetAt } : {}),
  }] };
}

export async function queryBailianTokenPlan(value: string | undefined): Promise<BalanceSample> {
  const keys = parseBailianAccessKeys(value);
  if (!keys) return { status: "unconfigured", metrics: [] };

  try {
    const configDir = await mkdtemp(join(tmpdir(), "zook-bailian-"));
    try {
      const { stdout } = await run(process.execPath, [
        resolvePackage("bailian-cli"), "usage", "token-plan", "--output", "json", "--quiet", "--timeout", "15",
      ], {
        env: {
          BAILIAN_CONFIG_DIR: configDir,
          BAILIAN_ACCESS_KEY_ID: keys.accessKey,
          BAILIAN_ACCESS_KEY_SECRET: keys.secretKey,
        },
        timeout: 20_000,
        killSignal: "SIGKILL",
        maxBuffer: 128 * 1024,
      });
      return parseBailianTokenPlanQuota(stdout);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  } catch (error) {
    // CLI output may contain details about credentials or the cloud account.
    if ((error as { code?: unknown })?.code === 3) return { status: "unauthorized", metrics: [] };
    return { status: "error", metrics: [], detail: "Bailian CLI quota query failed. Check the CLI and account access." };
  }
}
