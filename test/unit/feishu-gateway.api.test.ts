import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/application-factory.ts";
import { createFeishuServices } from "../../src/application-feishu-services.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { SecretReferenceResolver } from "../../src/services/secret-reference-resolver.ts";
import { digestIntegrationKey } from "../../src/modules/feishu/integration-access.ts";
import { defaultBalanceConfig } from "../../src/modules/llm-balances/balance-models.ts";
import { FEISHU } from "../../src/modules/feishu/feishu-config.ts";

test("public gateway authentication, target whitelist, durable replay, admin balance revisions and worker sharing", async () => {
  const runtime = await createApplication({ databaseFactory: seed => new InMemoryDatabase(seed),
    kvBackend: new InMemoryKVBackend(), queueBackend: "memory", adminBasicAuth: { username: "admin", password: "test-only" } });
  const { kvManager: kv, commonPasswordConfigService: passwords, appConfigService: configs, commonLlmConfigService: llm } = runtime.services;
  const key = "a".repeat(43); let messages = 0; let creditQueries = 0; let failQuery = false;
  const fetcher: typeof fetch = async url => {
    const path = String(url);
    if (path.includes("tenant_access_token")) return Response.json({ code: 0, tenant_access_token: "token", expire: 7200 });
    if (path.includes("im/v1/messages")) { messages++; return Response.json({ code: 0, data: { message_id: "message-1" } }); }
    if (path.includes("/credits")) { creditQueries++; return failQuery ? new Response("error", { status: 500 }) : Response.json({ data: { total_credits: 100, total_usage: 25 } }); }
    return Response.json({ success: true, data: { api_key_type: "personal", personal_balance: 1005 } });
  };
  const services = createFeishuServices(kv, passwords, configs, llm, new SecretReferenceResolver(passwords), runtime.logger, fetcher, ["test-billing-encryption-key"]);
  runtime.app.feishuServices = services;
  try {
    await passwords.upsertItem({ key: FEISHU.secretKey, value: "app-secret" });
    await passwords.upsertItem({ key: FEISHU.clientsKey, value: JSON.stringify([{ id: "test", digest: digestIntegrationKey(key), scopes: ["messages:send"] }]) });
    const headers = { authorization: `Bearer ${key}`, "idempotency-key": "message-api-test-01" };
    const message = { method: "POST", path: "/api/v1/notifications/feishu/messages", body: { text: "Test" }, headers };
    assert.equal((await runtime.app.handle({ ...message, headers: {} })).statusCode, 401);
    assert.equal((await runtime.app.handle({ ...message, body: { text: "Test", receive_id: "other" } })).statusCode, 400);
    assert.equal((await runtime.app.handle({ method: "GET", path: "/api/v1/integrations/feishu/bookkeeping/categories", headers })).statusCode, 403);
    const first = await runtime.app.handle(message);
    assert.equal(first.statusCode, 200); assert.equal((first.body.data as { status: string }).status, "accepted");
    assert.deepEqual((await runtime.app.handle(message)).body.data, first.body.data); assert.equal(messages, 1);
    assert.equal((await runtime.app.handle({ ...message, body: { text: "Other" } })).statusCode, 409);
    assert.equal((await runtime.app.handle({ method: "DELETE", path: "/api/v1/integrations/feishu/bookkeeping/records/recOther", headers })).statusCode, 404);
    const admin = { authorization: `Basic ${Buffer.from("admin:test-only").toString("base64")}` };
    const root = "/api/v1/admin/billing-accounts";
    assert.equal((await runtime.app.handle({ method: "GET", path: root, headers: {} })).statusCode, 401);
    const created = await runtime.app.handle({ method: "POST", path: root, headers: admin, body: {
      name: "Shared", type: "openrouter", providers: [], alerts: true, warning: 20, critical: 5, credential: "test-management-key",
    } });
    assert.equal(created.statusCode, 200);
    const id = (created.body.data as { id: string }).id;
    const now = new Date();
    await Promise.all([services.accounts.runDueChecks(now), services.accounts.runDueChecks(now)]);
    assert.equal(creditQueries, 1);
    await kv.delete("billing-lock", id);
    await services.accounts.runDueChecks(now); assert.equal(creditQueries, 1);
    failQuery = true; await kv.delete("billing-lock", id);
    await services.accounts.runDueChecks(new Date(now.getTime() + 300000));
    const doc = await services.accounts.document(); const main = doc.accounts[0].sample!;
    assert.equal(main.status, "error"); assert.equal(main.metrics[0].remaining, 75);
    assert.equal(main.lastSuccessAt, now.toISOString());
    assert.equal(JSON.stringify(doc).includes("test-management-key"), false);
    const manual = await runtime.app.handle({ method: "POST", path: root, headers: admin, body: { name: "Manual", type: "geyan", providers: [], alerts: false, warning: 1, critical: 0 } });
    const manualId = (manual.body.data as { id: string }).id;
    assert.equal((await runtime.app.handle({ method: "POST", path: `${root}/${manualId}/login/start`, body: {}, headers: {} })).statusCode, 401);
    let browserInput = "";
    services.manualLogins.operate = async (_account, _session, _owner, operation, input) => {
      assert.equal(operation, "input"); browserInput = (input as { text: string }).text; return { closed: false };
    };
    const typed = await runtime.app.handle({ method: "POST", path: `${root}/${manualId}/login/test-session/input`, headers: admin, body: { kind: "text", text: "test-private-verification" } });
    assert.equal(typed.statusCode, 200); assert.equal(typed.headers?.["Cache-Control"], "no-store"); assert.equal(browserInput, "test-private-verification");
    assert.equal(JSON.stringify(typed.body).includes("test-private-verification"), false);
    const audit = (runtime.database as InMemoryDatabase).auditLogs;
    assert.equal(JSON.stringify(audit).includes("test-private-verification"), false);
    assert.equal(messages, 1); // Shared account sampling does not send alerts for a healthy balance.
    assert.equal(JSON.stringify(runtime.logger.records).includes("test-management-key"), false);
    assert.equal(JSON.stringify(runtime.logger.records).includes("app-secret"), false);
  } finally { await runtime.close(); }
});
