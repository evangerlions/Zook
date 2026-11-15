import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createApplication } from "../src/application-factory.ts";
import { InMemoryDatabase } from "../src/testing/in-memory-database.ts";
import { KVManager } from "../src/infrastructure/kv/kv-manager.ts";
import { ConfigRevisionManager } from "../src/infrastructure/kv/config-revision-manager.ts";
import { readRequestBody } from "../src/infrastructure/http/request-body.ts";
import { FEISHU } from "../src/modules/feishu/feishu-config.ts";
import { digestIntegrationKey } from "../src/modules/feishu/integration-access.ts";
import { readFeishuCliSecret } from "./lib/feishu-cli-keychain.ts";
import { extractSecretReferenceKey } from "../src/services/secret-reference-resolver.ts";
import { PasswordManager } from "../src/services/password-manager.ts";
import { createAdminServer } from "../apps/admin-web/server.ts";

// Explicitly opt-in local acceptance server. Real Feishu calls; isolated persistent Redis.
const sourceEnv = resolve("../../deploy_configs/local.env");
if (existsSync(sourceEnv)) process.loadEnvFile(sourceEnv);
const sourceRedis = process.env.REDIS_URL;
process.env.ADMIN_SESSION_COOKIE_SECURE = "false";
process.env.ZOOK_LOCAL_FILE_LOGS = "1";
process.env.ZOOK_LOG_DIR = resolve(".zook/feishu-local/logs");
const kv = await KVManager.create({ redisUrl: "redis://127.0.0.1:16379" });
// Seed only a fresh acceptance store; preserve subsequent Admin edits across restarts.
const hasSavedLlmConfig = Boolean(await new ConfigRevisionManager<string>(kv, { scope: "app-config-revision:common:common.llm_service" }).getLatest());
const runtime = await createApplication({ databaseFactory: seed => new InMemoryDatabase(seed), kvManager: kv,
  queueBackend: "memory", appEnvironment: "local", serviceName: "api", emitLogs: false,
  adminBasicAuth: { username: "feishu-local", password: "local-acceptance-only" } });
await runtime.services.commonPasswordConfigService.upsertItem({ key: FEISHU.secretKey, value: readFeishuCliSecret(), desc: "Local Feishu acceptance app" });
let apiKey: string;
try { apiKey = execFileSync("/usr/bin/security", ["find-generic-password", "-s", "zook.feishu-integration", "-a", "mac", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
catch {
  apiKey = randomBytes(32).toString("base64url");
  execFileSync("/usr/bin/security", ["add-generic-password", "-U", "-s", "zook.feishu-integration", "-a", "mac", "-w", apiKey], { stdio: "ignore" });
}
await runtime.services.commonPasswordConfigService.upsertItem({ key: FEISHU.clientsKey,
  value: JSON.stringify([{ id: "mac", digest: digestIntegrationKey(apiKey), scopes: ["messages:send", "bookkeeping:read", "bookkeeping:create"] }]), desc: "Local integration scopes and digest" });
apiKey = "";

if (!hasSavedLlmConfig && sourceRedis && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(sourceRedis).hostname)) {
  const source = await KVManager.create({ redisUrl: sourceRedis });
  try {
    const latest = await new ConfigRevisionManager<string>(source, { scope: "app-config-revision:common:common.llm_service" }).getLatest();
    if (latest) {
      const config = JSON.parse(latest.content);
      await runtime.services.appConfigService.setValue("common", "common.llm_service", JSON.stringify(config), "Local balance acceptance snapshot");
      const sourcePasswords = new PasswordManager(source);
      const names = new Set<string>(config.providers.map((provider: { apiKey: string }) => extractSecretReferenceKey(provider.apiKey)).filter(Boolean));
      for (const proxy of [config.openRouter, config.bai]) if (proxy?.transparentProxyHmacSecretKey) names.add(proxy.transparentProxyHmacSecretKey);
      for (const name of names) {
        const value = await sourcePasswords.getValue("common-passwords", name);
        if (value) await runtime.services.commonPasswordConfigService.upsertItem({ key: name, value, desc: "Local balance acceptance credential" });
      }
      console.log(JSON.stringify({ source: "local saved LLM config", providers: config.providers.map((p: { key: string; type: string }) => ({ key: p.key, type: p.type })) }));
    }
  } catch { console.log("Existing local provider config unavailable; no account credentials were inferred."); }
  finally { await source.disconnect(); }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value]));
    const result = await runtime.app.handle({ method: request.method ?? "GET", path: url.pathname, headers,
      query: Object.fromEntries(url.searchParams), body: await readRequestBody(request, request.headers["content-type"], 16 * 1024), ipAddress: "127.0.0.1" });
    response.statusCode = result.statusCode;
    response.setHeader("Content-Type", "application/json");
    for (const [key, value] of Object.entries(result.headers ?? {})) response.setHeader(key, value);
    response.end(JSON.stringify(result.body));
  } catch { response.statusCode = 400; response.end("Invalid request"); }
});
server.listen(3196, "127.0.0.1");
process.env.PORT = "3197";
const admin = createAdminServer({ proxyTarget: "http://127.0.0.1:3196" });
admin.listen(3197, "127.0.0.1");
console.log("Feishu local acceptance API: http://127.0.0.1:3196; Admin: http://127.0.0.1:3197/llm");
const tick = () => runtime.services.feishuServices.accounts.runDueChecks().catch(() => console.log("Local balance check failed."));
await tick();
const timer = setInterval(() => void tick(), 60_000);
process.once("SIGTERM", () => { clearInterval(timer); server.close(); admin.close(); void runtime.close().then(() => kv.disconnect()).then(() => process.exit(0)); });
