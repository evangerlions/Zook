import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import { FeishuClient } from "../../src/modules/feishu/feishu-client.ts";
import { FEISHU } from "../../src/modules/feishu/feishu-config.ts";
import { IntegrationAccess, digestIntegrationKey } from "../../src/modules/feishu/integration-access.ts";
import { IntegrationReceipts } from "../../src/modules/feishu/integration-receipts.ts";
import { FeishuBookkeeping } from "../../src/modules/feishu/bookkeeping.ts";
import { expenseInput } from "../../src/modules/feishu/expense-input.ts";

async function fixture() {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const passwords = new CommonPasswordConfigService(new PasswordManager(kv));
  await passwords.upsertItem({ key: FEISHU.secretKey, value: "test-app-secret" });
  return { kv, passwords };
}

test("tenant token is shared across concurrent callers and service restarts; expiry and credential rotation reacquire it", async () => {
  const { kv, passwords } = await fixture();
  let acquired = 0;
  const fetcher: typeof fetch = async () => Response.json({ code: 0, tenant_access_token: `token-${++acquired}`, expire: 7200 });
  const first = new FeishuClient(kv, passwords, fetcher);
  assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => first.token())), Array(8).fill("token-1"));
  const restarted = new FeishuClient(kv, passwords, fetcher);
  assert.equal(await restarted.token(), "token-1");
  const fingerprint = createHash("sha256").update(FEISHU.appId + "test-app-secret").digest("hex");
  await kv.setJson("feishu-token", fingerprint, { token: "expired", validUntil: 0 });
  await kv.delete("feishu-token-lock", fingerprint);
  assert.equal(await restarted.token(), "token-2");
  await passwords.upsertItem({ key: FEISHU.secretKey, value: "rotated-app-secret" });
  assert.equal(await restarted.token(), "token-3");
  assert.equal(acquired, 3);
});

test("dedicated API keys enforce scopes, revocation and per-operation rate limits", async () => {
  const { kv, passwords } = await fixture();
  const access = new IntegrationAccess(kv, passwords);
  const key = randomBytes(32).toString("base64url");
  const clients = [{ id: "mac", digest: digestIntegrationKey(key), scopes: ["messages:send"] }];
  await passwords.upsertItem({ key: FEISHU.clientsKey, value: JSON.stringify(clients) });
  const request = { method: "POST", path: "/", headers: { authorization: `Bearer ${key}` }, ipAddress: "127.0.0.1" };
  assert.equal(await access.authorize(request, "messages:send"), "mac");
  await assert.rejects(access.authorize(request, "bookkeeping:create"), { statusCode: 403 });
  await assert.rejects(access.authorize({ ...request, headers: {} }, "messages:send"), { statusCode: 401 });
  for (let i = 1; i < 10; i++) await access.authorize(request, "messages:send");
  await assert.rejects(access.authorize(request, "messages:send"), { statusCode: 429 });
  await passwords.upsertItem({ key: FEISHU.clientsKey, value: "[]" });
  await assert.rejects(access.authorize(request, "messages:send"), { statusCode: 401 });
});

test("concurrent idempotent writes run once, survive restarts and reject conflicting payloads", async () => {
  const { kv } = await fixture(); const receipts = new IntegrationReceipts(kv); let writes = 0;
  const write = async () => { writes++; await new Promise(resolve => setTimeout(resolve, 10)); return { messageId: "m1" }; };
  const results = await Promise.all(Array.from({ length: 8 }, () => receipts.execute("mac", "send", "operation-1", { text: "hello" }, write)));
  assert.equal(writes, 1);
  assert.ok(results.some(item => item.status === "accepted"));
  const replay = await new IntegrationReceipts(kv).execute("mac", "send", "operation-1", { text: "hello" }, write);
  assert.equal(replay.status, "accepted"); assert.deepEqual(replay.result, { messageId: "m1" });
  await assert.rejects(receipts.execute("mac", "send", "operation-1", { text: "changed" }, write), { statusCode: 409 });
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(replay).includes("hello"), false);
});

test("uncertain external mutations remain unknown and are never silently retried", async () => {
  const { kv } = await fixture(); const receipts = new IntegrationReceipts(kv); let writes = 0;
  const write = async () => { writes++; throw new Error("network timeout after acceptance"); };
  assert.equal((await receipts.execute("mac", "ledger", "operation-2", {}, write)).status, "unknown");
  assert.equal((await new IntegrationReceipts(kv).execute("mac", "ledger", "operation-2", {}, write)).status, "unknown");
  assert.equal(writes, 1);
});

test("expense input rejects extra targets, invalid amounts and system fields; categories are validated live", async () => {
  const valid = { title: "Test", amount: 0, category: "Server", subcategory: "Other" };
  assert.equal(expenseInput(valid).source, "支出-从公共账户");
  for (const value of [{ ...valid, base: "other" }, { ...valid, amount: -1 }, { ...valid, amount: 0.001 }, { ...valid, recordId: "recOther" }]) {
    assert.throws(() => expenseInput(value), { statusCode: 400 });
  }
  const { kv, passwords } = await fixture();
  const fetcher: typeof fetch = async url => {
    const path = String(url);
    if (path.includes("tenant_access_token")) return Response.json({ code: 0, tenant_access_token: "t", expire: 7200 });
    if (path.includes(FEISHU.categories) && path.includes("fields")) return Response.json({ code: 0, data: { items: [{ field_id: "fldQbmLf6H", field_name: "Major" }, { field_id: "fldRqyrIId", field_name: "Minor" }] } });
    if (path.includes(FEISHU.categories)) return Response.json({ code: 0, data: { data: [["Server", "Other"]], fields: ["Major", "Minor"], field_id_list: ["fldQbmLf6H", "fldRqyrIId"], record_id_list: ["recCategory"], has_more: false } });
    return Response.json({ code: 0, data: { items: [] } });
  };
  const ledger = new FeishuBookkeeping(new FeishuClient(kv, passwords, fetcher));
  assert.deepEqual(await ledger.categories(), [{ category: "Server", subcategory: "Other" }]);
  await assert.rejects(ledger.prepare(expenseInput({ ...valid, category: "Wrong" })), { statusCode: 400 });
});

test("Base v3 record_not_found is not reported as an empty successful expense", async () => {
  const { kv, passwords } = await fixture();
  const fetcher: typeof fetch = async url => String(url).includes("tenant_access_token")
    ? Response.json({ code: 0, tenant_access_token: "token", expire: 7200 })
    : Response.json({ code: 0, data: { data: [[null]], fields: ["消费条目"], field_id_list: ["fld5Fl8zA8"], record_id_list: ["recDeleted"], record_not_found: ["recDeleted"], has_more: false } });
  const ledger = new FeishuBookkeeping(new FeishuClient(kv, passwords, fetcher));
  await assert.rejects(ledger.get("recDeleted"), { statusCode: 404 });
});
