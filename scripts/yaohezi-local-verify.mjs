import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { userInfo } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createServer, createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

// Local verification never reads DATABASE_URL or connects to a remote host.
const port = Number(process.env.YAOHEZI_LOCAL_PG_PORT ?? 5432);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local PostgreSQL port");
const user = process.env.PGUSER ?? userInfo().username;
const name = `yaohezi_local_${Date.now()}_${randomBytes(4).toString("hex")}`;
const output = resolve(".artifacts/yaohezi", name);
await mkdir(output, { recursive: true });
const administrator = new Client({ host: "127.0.0.1", port, user, database: "postgres" });
await administrator.connect();
try { await administrator.query(`CREATE DATABASE "${name}"`); }
finally { await administrator.end(); }
const connectionString = `postgresql://${encodeURIComponent(user)}@127.0.0.1:${port}/${name}`;
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
const redisPort = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const redisPassword = randomBytes(32).toString("hex");
const redis = spawn("redis-server", ["--bind", "127.0.0.1", "--port", String(redisPort), "--requirepass", redisPassword,
  "--save", "", "--appendonly", "no", "--dir", output, "--logfile", resolve(output, "redis.log")], { stdio: "ignore" });
let redisFailure;
redis.once("error", (error) => { redisFailure = error; });
const redisClosed = new Promise((resolve) => redis.once("close", resolve));
const stopRedis = () => { if (redis.exitCode === null) redis.kill("SIGTERM"); };
process.once("SIGINT", stopRedis);
process.once("SIGTERM", stopRedis);
try {
  let ready = false;
  for (let attempt = 0; attempt < 50 && !ready; attempt++) {
    if (redisFailure) throw redisFailure;
    if (redis.exitCode !== null) throw new Error("Isolated Redis exited before verification; inspect redis.log");
    ready = await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port: redisPort });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
      socket.setTimeout(100, () => { socket.destroy(); resolve(false); });
    });
    if (!ready) await delay(100);
  }
  if (!ready) throw new Error("Isolated Redis did not become ready");
const env = { ...process.env, YAOHEZI_TEST_DATABASE_URL: connectionString,
  YAOHEZI_TEST_REDIS_URL: `redis://:${redisPassword}@127.0.0.1:${redisPort}/0` };
const command = ["--experimental-transform-types", "--test", "--test-concurrency=1",
  "test/integration/yaohezi-local-postgres.test.ts", "test/integration/yaohezi-profiles-postgres.test.ts"];
const child = spawn(process.execPath, command, { env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (value) => { log += value; });
child.stderr.on("data", (value) => { log += value; });
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
await writeFile(resolve(output, "postgres.log"), log);
await writeFile(resolve(output, "result.json"), JSON.stringify({ database: name, host: "127.0.0.1", port,
  status: code === 0 ? "passed" : "failed", smsTransport: "local test fixture; no external SMS sent",
  tokenStorage: "real isolated Redis; application restart tested", membershipStorage: "real PostgreSQL",
  queue: "in-memory local fixture; no external worker or push delivery",
  createdAt: new Date().toISOString(), log: "postgres.log" }, null, 2));
console.log(`Yaohezi local PostgreSQL verification: ${code === 0 ? "PASS" : "FAIL"}`);
console.log(`Evidence: ${output}`);
console.log(`Isolated database retained for inspection: ${name}`);
if (code !== 0) console.error(log.slice(-5000));
process.exitCode = code === 0 ? 0 : 1;
} finally {
  stopRedis();
  await redisClosed;
  process.removeListener("SIGINT", stopRedis);
  process.removeListener("SIGTERM", stopRedis);
}
