import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://127.0.0.1:3101";
const MOCK_KEYS = new Set(["", "mock-bailian-api-key", "mock-openrouter-api-key"]);

export function parseEnvironment(entries = []) {
  return Object.fromEntries(entries.map(entry => {
    const separator = entry.indexOf("=");
    return separator < 0 ? [entry, ""] : [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
}

export function countTokens(value) {
  return String(value ?? "").split(",").map(item => item.trim()).filter(Boolean).length;
}

export function classifyCredential(value) {
  const normalized = String(value ?? "").trim();
  return MOCK_KEYS.has(normalized) || /^\*+$/.test(normalized) ? "mock_or_missing" : "configured";
}

function inspectContainer(name) {
  if (!name) return {};
  try {
    const output = execFileSync("docker", ["inspect", "--format", "{{json .Config.Env}}", name], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return parseEnvironment(JSON.parse(output));
  } catch {
    return {};
  }
}

function fileReadableInContainer(container, path) {
  if (!container || !path) return false;
  try {
    execFileSync("docker", ["exec", container, "test", "-r", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function candidateSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectDev(baseUrl, apiEnvironment) {
  const result = { reachable: false, productEnabled: false, llmEnabled: false, realRoutes: [], issues: [] };
  try {
    const publicConfig = await fetchJson(`${baseUrl}/api/v1/lighttick/public/config`);
    result.reachable = publicConfig.status === 200;
    result.productEnabled = publicConfig.body?.data?.enabled === true;
    if (!result.reachable) result.issues.push(`public_config_http_${publicConfig.status}`);
    else if (!result.productEnabled) result.issues.push("lighttick_product_disabled");
  } catch {
    result.issues.push("dev_unreachable");
  }

  const username = apiEnvironment.ADMIN_BASIC_AUTH_USERNAME ?? process.env.LIGHTTICK_ADMIN_USERNAME;
  const password = apiEnvironment.ADMIN_BASIC_AUTH_PASSWORD ?? process.env.LIGHTTICK_ADMIN_PASSWORD;
  if (!username || !password) {
    result.issues.push("admin_credentials_missing");
    return result;
  }
  try {
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    const response = await fetchJson(`${baseUrl}/api/v1/admin/apps/common/llm-service`, { headers: { authorization } });
    if (response.status !== 200) {
      result.issues.push(`llm_config_http_${response.status}`);
      return result;
    }
    const config = response.body?.data?.config;
    result.llmEnabled = config?.enabled === true;
    const providers = new Map((config?.providers ?? []).map(provider => [provider.key, provider]));
    result.realRoutes = (config?.models ?? []).flatMap(model => (model.routes ?? []).filter(route => {
      const provider = providers.get(route.provider);
      return route.enabled && provider?.enabled && classifyCredential(provider.apiKey) === "configured";
    }).map(route => ({ modelKey: model.key, provider: route.provider, providerModel: route.providerModel })));
    if (!result.llmEnabled) result.issues.push("llm_service_disabled");
    if (result.realRoutes.length === 0) result.issues.push("real_llm_route_missing");
  } catch {
    result.issues.push("llm_config_unreachable");
  }
  return result;
}

function inspectPush(workerEnvironment, workerContainer) {
  const apnsPath = workerEnvironment.APNS_PRIVATE_KEY_PATH;
  const apnsConfigured = Boolean(workerEnvironment.APNS_KEY_ID && workerEnvironment.APNS_TEAM_ID &&
    (workerEnvironment.LIGHTTICK_APNS_BUNDLE_ID || workerEnvironment.APNS_BUNDLE_ID || workerEnvironment.APNS_TOPIC) &&
    apnsPath && fileReadableInContainer(workerContainer, apnsPath));
  const fcmPath = workerEnvironment.LIGHTTICK_FCM_SERVICE_ACCOUNT_PATH ?? workerEnvironment.FCM_SERVICE_ACCOUNT_PATH;
  const fcmConfigured = Boolean((workerEnvironment.LIGHTTICK_FCM_PROJECT_ID || workerEnvironment.FCM_PROJECT_ID) &&
    fcmPath && fileReadableInContainer(workerContainer, fcmPath));
  const apnsTokenCount = countTokens(process.env.LIGHTTICK_APNS_SMOKE_TOKENS);
  const fcmTokenCount = countTokens(process.env.LIGHTTICK_FCM_SMOKE_TOKENS);
  const issues = [];
  if (!apnsConfigured) issues.push("apns_credentials_incomplete");
  if (apnsConfigured && workerEnvironment.APNS_SANDBOX !== "true") issues.push("apns_dev_must_use_sandbox");
  if (!fcmConfigured) issues.push("fcm_credentials_incomplete");
  if (apnsTokenCount < 2) issues.push("apns_multiple_device_tokens_missing");
  if (fcmTokenCount < 2) issues.push("fcm_multiple_device_tokens_missing");
  return {
    apns: { configured: apnsConfigured, sandbox: workerEnvironment.APNS_SANDBOX === "true", deviceTokenCount: apnsTokenCount },
    fcm: { configured: fcmConfigured, deviceTokenCount: fcmTokenCount },
    issues,
  };
}

export async function runPreflight() {
  const apiContainer = process.env.LIGHTTICK_PROVIDER_API_CONTAINER ?? "zook-dev-api-1";
  const workerContainer = process.env.LIGHTTICK_PROVIDER_WORKER_CONTAINER ?? "zook-dev-worker-1";
  const apiEnvironment = inspectContainer(apiContainer);
  const workerEnvironment = inspectContainer(workerContainer);
  const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const dev = await inspectDev(baseUrl, apiEnvironment);
  const push = inspectPush(workerEnvironment, workerContainer);
  const issues = [...dev.issues, ...push.issues];
  const report = {
    schema: "lighttick-provider-preflight/v1",
    candidateSha: candidateSha(),
    checkedAt: new Date().toISOString(),
    ready: issues.length === 0,
    dev: { reachable: dev.reachable, productEnabled: dev.productEnabled },
    llm: { enabled: dev.llmEnabled, realRoutes: dev.realRoutes },
    push: { apns: push.apns, fcm: push.fcm },
    issues,
  };
  const reportPath = process.env.LIGHTTICK_PROVIDER_REPORT_PATH;
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const report = await runPreflight();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ready ? 0 : 2;
}
