// 一次性验收账号（方案 A）。
//
// 目的：tutor-first-lesson / work-report-practice 这类“首次进入”验收需要
// 一个没有 onboarding、没有学习数据的干净账号；共享 alice/bob 无法重复使用。
//
// 约束（故意写死，避免误伤真实数据）：
//   - 只在 APP_ENV=local（或 NODE_ENV 非 production）下运行；
//   - DATABASE_URL 必须是本机 127.0.0.1/localhost，库名以 _local / _integration 结尾；
//   - 邮箱固定 qa-<时间戳>-<随机>@local.test，密码只写 --out 文件（0600），不默认回显；
//   - 只 INSERT 用户与 LightTick 绑定，不删除任何既有账号；清理请人工按邮箱执行。
//
// 用法：
//   node --env-file=.env.local scripts/lighttick-qa-account.mjs --dry-run
//   node --env-file=.env.local scripts/lighttick-qa-account.mjs --out=/tmp/lighttick-qa.json
//
// 输出 JSON：{ email, password, user_id, app_id, created_at }

import { Pool } from "pg";
import { hashSync, Algorithm } from "@node-rs/argon2";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outIndex = args.findIndex((value) => value.startsWith("--out="));
const outPath = outIndex >= 0 ? args[outIndex].slice("--out=".length) : "";
const emailArg = args.find((value) => value.startsWith("--email="))?.slice("--email=".length);

const databaseUrl = String(process.env.DATABASE_URL ?? "");
const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
const apiBase = String(process.env.LIGHTTICK_API_BASE ?? "http://127.0.0.1:3100").replace(/\/$/, "");

function fail(message) {
  console.error("[qa-account] " + message);
  process.exit(1);
}

if (!databaseUrl) fail("缺少 DATABASE_URL；请用 node --env-file=.env.local 运行。");
if (appEnv !== "local" && nodeEnv === "production") fail("只允许在本地环境建验收账号。");

let url;
try {
  url = new URL(databaseUrl);
} catch {
  fail("DATABASE_URL 无法解析。");
}
if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
  fail("DATABASE_URL 不是本机地址，拒绝执行。");
}
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (!/(_local|_integration)$/.test(database)) {
  fail(`库名 ${database} 不以 _local/_integration 结尾，拒绝执行。`);
}

const suffix = Date.now().toString(36) + randomBytes(3).toString("hex");
const email = emailArg ?? `qa-${suffix}@local.test`;
if (!/^qa-[a-z0-9-]+@local\.test$/.test(email)) {
  fail("邮箱必须是 qa-<slug>@local.test，避免误建到真实域。");
}
const password = `Qa${randomBytes(6).toString("hex")}9`;
if (password.length < 8) fail("生成的密码不合规。");

const userId = `user_qa_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const appUserRowId = `app_user_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const roleRowId = `user_role_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const passwordHash = hashSync(password, {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
});

const statements = [
  {
    sql: `INSERT INTO zook_users (id, email, password_hash, password_algo, status, credential_version)
          VALUES ($1, $2, $3, 'argon2id', 'ACTIVE', 1)`,
    params: [userId, email, passwordHash],
    label: "zook_users",
  },
  {
    sql: `INSERT INTO zook_app_users (id, app_id, user_id, status, account_region)
          VALUES ($1, 'lighttick', $2, 'ACTIVE', 'UNKNOWN')`,
    params: [appUserRowId, userId],
    label: "zook_app_users",
  },
  {
    sql: `INSERT INTO zook_app_auth_accounts (app_id, user_id, revision, phone_prompt_offered)
          VALUES ('lighttick', $1, 1, false)`,
    params: [userId],
    label: "zook_app_auth_accounts",
  },
  {
    sql: `INSERT INTO zook_user_roles (id, app_id, user_id, role_id)
          VALUES ($1, 'lighttick', $2, 'role_lighttick_member')`,
    params: [roleRowId, userId],
    label: "zook_user_roles",
  },
];

const record = {
  email,
  password,
  user_id: userId,
  app_id: "lighttick",
  created_at: new Date().toISOString(),
};

if (dryRun) {
  console.log(JSON.stringify({
    dry_run: true,
    database,
    app_env: appEnv,
    planned: {
      email,
      user_id: userId,
      rows: statements.map((item) => item.label),
      note: "不会写入数据库；真实执行时密码只写 --out 文件。",
    },
  }, null, 2));
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const roleExists = await client.query(
    "SELECT 1 FROM zook_roles WHERE id = 'role_lighttick_member'",
  ).catch(() => ({ rowCount: 0 }));
  if (!roleExists.rowCount) throw new Error("缺少 role_lighttick_member，先跑迁移。");
  for (const item of statements) {
    await client.query(item.sql, item.params);
  }
  await client.query("COMMIT");
  client.release();
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
  fail("建号失败：" + error.message);
}

let loginOk = false;
try {
  const response = await fetch(apiBase + "/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-app-id": "lighttick" },
    body: JSON.stringify({ appId: "lighttick", account: email, password, clientType: "web" }),
  });
  loginOk = response.ok;
  if (!loginOk) {
    const body = await response.text();
    console.error("[qa-account] 建号成功但登录校验失败：" + response.status + " " + body.slice(0, 200));
  }
} catch (error) {
  console.error("[qa-account] 建号成功但 API 不可达：" + error.message);
}
await pool.end();

if (outPath) {
  writeFileSync(outPath, JSON.stringify({ ...record, login_ok: loginOk }, null, 2) + "\n", { mode: 0o600 });
}
console.log(JSON.stringify({
  created: true,
  email,
  user_id: userId,
  login_ok: loginOk,
  out: outPath ? outPath : null,
  password_note: outPath ? "密码已写入 --out 文件（0600）" : "未指定 --out，密码未回显；请重跑并加 --out",
}, null, 2));
if (!loginOk) process.exit(2);
