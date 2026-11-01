// Loopback-only iOS fixture. Never imported by the deployed API/worker.
import { Client } from "pg";
import { createServer as createHTTPServer } from "node:http";
import { createServer as createTCPServer, createConnection } from "node:net";
import { spawn } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApplication } from "../src/app.module.ts";
import { KVManager } from "../src/infrastructure/kv/kv-manager.ts";
import { RefreshTokenStore } from "../src/services/refresh-token-store.ts";
import { readRequestBody } from "../src/infrastructure/http/request-body.ts";

import { DevelopmentPasswordHasher } from "../src/modules/auth/password-hasher.ts";

const pgPort = Number(process.env.YAOHEZI_LOCAL_PG_PORT ?? 5432);
const httpPort = Number(process.env.YAOHEZI_LOCAL_HTTP_PORT ?? 18763);
if (![pgPort, httpPort].every(value => Number.isInteger(value) && value > 0 && value < 65536)) throw new Error("Invalid local port");
const name = `yaohezi_local_ios_${Date.now()}_${randomBytes(4).toString("hex")}`;
const output = resolve(".artifacts/yaohezi", name);
await mkdir(output, { recursive: true });
const user = process.env.PGUSER ?? userInfo().username;
const admin = new Client({ host: "127.0.0.1", port: pgPort, user, database: "postgres" });
await admin.connect();
try { await admin.query(`CREATE DATABASE "${name}"`); } finally { await admin.end(); }
const reservation = createTCPServer();
await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
const redisPort = (reservation.address() as { port: number }).port;
await new Promise<void>(resolve => reservation.close(() => resolve()));
const password = randomBytes(32).toString("hex");
const redis = spawn("redis-server", ["--bind", "127.0.0.1", "--port", String(redisPort), "--requirepass", password,
  "--save", "", "--appendonly", "no", "--dir", output, "--logfile", resolve(output, "redis.log")], { stdio: "ignore" });
let redisError: Error | undefined;
redis.once("error", error => { redisError = error; });
const redisClosed = new Promise(resolve => redis.once("close", resolve));
let runtime: Awaited<ReturnType<typeof createApplication>> | undefined;
let kv: KVManager | undefined;
let server: ReturnType<typeof createHTTPServer> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try {
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
    await runtime?.close();
  } finally {
    try { await kv?.disconnect(); }
    finally { if (redis.exitCode === null) redis.kill("SIGTERM"); await redisClosed; }
  }
}
const shutdown = () => { void close().then(() => process.exit(0), () => process.exit(1)); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
try {
  let ready = false;
  for (let attempt = 0; attempt < 50 && !ready; attempt++) {
    if (redisError) throw redisError;
    if (redis.exitCode !== null) throw new Error("Local Redis failed to start");
    ready = await new Promise<boolean>(resolve => {
      const socket = createConnection({ host: "127.0.0.1", port: redisPort });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
      socket.setTimeout(100, () => { socket.destroy(); resolve(false); });
    });
    if (!ready) await delay(100);
  }
  if (!ready) throw new Error("Local Redis not ready");
  kv = await KVManager.create({ redisUrl: `redis://:${password}@127.0.0.1:${redisPort}/0` });
  await kv.assertReady();
  const codes = new Map<string, string>();
  const allowedPhones = ["15530000001", "15530000002"];
  const counters = { refreshRequests: 0, refreshSucceeded: 0, logoutRequests: 0, meRequests: 0, healthRequests: 0, redirectLeaks: 0 };
  let redirectLogin = false;
  const databaseUrl = `postgresql://${encodeURIComponent(user)}@127.0.0.1:${pgPort}/${name}`;
  runtime = await createApplication({ databaseUrl, migrationDatabaseUrl: databaseUrl, kvManager: kv,
    yaoheziEnabled: true, yaoheziHealthEnabled: process.env.YAOHEZI_LOCAL_HEALTH_DEVICES === "1", frogsleepEnabled: false, lighttickEnabled: false, queueBackend: "memory",
    fileStorageRoot: resolve(output, "files"), accessTokenSecret: randomBytes(48).toString("hex"),
    publicSmsTestBypassEnabled: false,
    smsVerificationSender: { async sendVerificationCode(command) {
      codes.set(command.phoneNumber, command.code);
      return { provider: "tencent_sms", phoneNumber: command.phoneNumber };
    } } });
  const tokens = new RefreshTokenStore(kv);
  server = createHTTPServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = await readRequestBody(request, request.headers["content-type"]);
      if (url.pathname === "/__local/redirect-leak") counters.redirectLeaks++;
      if (url.pathname.startsWith("/__local/")) {
        if (request.headers["x-yaohezi-local-fixture"] !== "ios-account-tests-v1") return send(403, { code: "LOCAL_FIXTURE_ONLY" });
        if (url.pathname === "/__local/health") return send(200, { fixture: "yaohezi-local-ios-v1", ...counters });
        if (url.pathname === "/__local/native-account" && request.method === "POST") {
          const id = randomUUID(), account = `native-${id}@example.test`, password = randomBytes(24).toString("base64url");
          const hasher = new DevelopmentPasswordHasher();
          await runtime!.database.insertUser({ id, email: account, passwordHash: hasher.hash(password),
            passwordAlgo: hasher.algorithm, status: "ACTIVE", createdAt: new Date().toISOString() });
          // No tokens, memberships or health grants. The test must authenticate through normal /auth/login.
          return send(200, { account, password });
        }
        if (url.pathname === "/__local/phones") {
          if (allowedPhones.length >= 100) return send(429, { code: "LOCAL_FIXTURE_RESTART_REQUIRED" });
          const phones: string[] = [];
          while (phones.length < 2) {
            const phone = String(15530000000 + randomInt(1_000_000));
            if (!allowedPhones.includes(phone)) { allowedPhones.push(phone); phones.push(phone); }
          }
          return send(200, { phones });
        }
        if (url.pathname === "/__local/redirect-login" && request.method === "POST") { redirectLogin = true; return send(200, {}); }
        if (url.pathname === "/__local/otp") {
          const phone = url.searchParams.get("phone") ?? "";
          if (!allowedPhones.includes(phone)) return send(400, {});
          const code = [...codes.entries()].find(([number]) => number.endsWith(phone))?.[1];
          return send(code ? 200 : 404, code ? { code } : {});
        }
        if (url.pathname === "/__local/revoke-user" && request.method === "POST") {
          const id = (body as { userId?: string })?.userId;
          if (!id) return send(400, {});
          await tokens.revokeAllByUserAndApp("yaohezi", id, new Date().toISOString());
          return send(200, { revoked: true });
        }
        return send(404, {});
      }
      if (url.pathname.includes("/sms") && !allowedPhones.includes((body as { phone?: string })?.phone ?? "")) {
        return send(400, { code: "LOCAL_SYNTHETIC_PHONES_ONLY" });
      }
      if (url.pathname === "/api/v1/auth/login/sms" && redirectLogin) {
        redirectLogin = false;
        response.writeHead(307, { Location: `http://localhost:${httpPort}/__local/redirect-leak` });
        return response.end();
      }
      if (url.pathname.endsWith("/refresh")) counters.refreshRequests++;
      if (url.pathname.endsWith("/logout")) counters.logoutRequests++;
      if (url.pathname === "/api/v1/yaohezi/me") counters.meRequests++;
      else if (url.pathname.startsWith("/api/v1/yaohezi/")) counters.healthRequests++;
      const result = await runtime!.app.handle({ method: request.method ?? "GET", path: url.pathname,
        headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])),
        body, query: Object.fromEntries(url.searchParams), ipAddress: "127.0.0.1", hostname: "localhost" });
      if (url.pathname.endsWith("/refresh") && result.statusCode === 200) counters.refreshSucceeded++;
      send(result.statusCode, result.body);
    } catch { send(500, { code: "LOCAL_FIXTURE_ERROR" }); }
  });
  await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(httpPort, "127.0.0.1", resolve); });
  await writeFile(resolve(output, "fixture.json"), JSON.stringify({ baseURL: `http://127.0.0.1:${httpPort}`,
    database: name, sms: "local capture, normal verification, no test bypass", queue: "memory fixture" }, null, 2));
  console.log(`Local iOS fixture ready: http://127.0.0.1:${httpPort}`);
  console.log(`Evidence: ${output}`);
} catch (error) { await close(); throw error; }
