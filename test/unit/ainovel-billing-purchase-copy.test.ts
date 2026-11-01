import assert from "node:assert/strict";
import test from "node:test";
import { billingPurchaseSubtitle, billingPurchaseTitle } from "../../src/modules/billing/ainovel-billing-purchase-copy.ts";
import { BILLING_BENEFITS_CONFIG_KEY } from "../../src/modules/billing/ainovel-billing-benefits.ts";
import { createApplication } from "../support/create-test-application.ts";

test("purchase subtitle has no default, reuses locale fallback and permits clearing", () => {
  for (const config of [undefined, '{}', '{"purchaseSubtitle":null}', '{"purchaseSubtitle":{"en-US":" "}}']) {
    assert.equal(billingPurchaseSubtitle("en-US", config), null);
  }
  const raw = JSON.stringify({purchaseSubtitle:{"zh-CN":"测试副标题 from server", "en-US":"Test subtitle from server"}});
  assert.equal(billingPurchaseSubtitle("zh-CN", raw), "测试副标题 from server");
  assert.equal(billingPurchaseSubtitle("fr-FR", raw), "Test subtitle from server");
  assert.throws(() => billingPurchaseSubtitle("en-US", '{"purchaseSubtitle":123}'));
});

test("guest catalog reads configured subtitle and clears it on next fetch", async () => {
  const runtime = await createApplication();
  const request = (locale = "zh-CN") => runtime.app.handle({ method:"GET", path:"/api/v1/ai_novel/billing/catalog",
    headers:{"x-app-id":"ai_novel", "x-app-locale":locale}, query:{platform:"web", distribution:"web"}});
  assert.equal((await request()).body.data.products[0].purchaseSubtitle, null);
  const save = (configValue: string) => runtime.database.upsertAppConfig({id:"purchase_copy_test",appId:"ai_novel",
    configKey:BILLING_BENEFITS_CONFIG_KEY,configValue,updatedAt:new Date().toISOString()});
  await save(JSON.stringify({purchaseSubtitle:{"zh-CN":"测试副标题 from server", "en-US":"Test subtitle from server"},
    purchaseTitle:{"zh-CN":"立即升级", "en-US":"Upgrade now"}}));
  const response = await request();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.products.every(p => p.purchaseSubtitle === "测试副标题 from server"), true);
  assert.equal(response.body.data.products.every(p => p.purchaseTitle === "立即升级"), true);
  assert.equal((await request("en-US")).body.data.products[0].purchaseSubtitle, "Test subtitle from server");
  await save('{}');
  assert.equal((await request()).body.data.products[0].purchaseSubtitle, null);
  assert.equal((await request()).body.data.products[0].purchaseTitle, null);
});

test("title is optional, localized and never fabricates client default", () => {
  for (const config of [undefined, '{}', '{"purchaseTitle":null}', '{"purchaseTitle":{"en-US":"  "}}']) {
    assert.equal(billingPurchaseTitle("zh-CN", config), null);
  }
  const config = JSON.stringify({purchaseTitle:{"zh-CN":"  立即升级  ","en-US":"Upgrade now"}});
  assert.equal(billingPurchaseTitle("zh-CN", config), "立即升级");
  assert.equal(billingPurchaseTitle("fr-FR", config), "Upgrade now");
  assert.throws(() => billingPurchaseTitle("en-US", '{"purchaseTitle":false}'));
});
