import assert from "node:assert/strict";
import test from "node:test";
import { buildAiNovelBillingCatalog } from "../../src/modules/billing/ainovel-billing-catalog.ts";
import { billingBenefits, parseBillingBenefitsConfig, BILLING_BENEFITS_CONFIG_KEY } from "../../src/modules/billing/ainovel-billing-benefits.ts";
import { LOCAL_CREDIT_QUOTAS } from "../../src/modules/ai-novel/credits/ai-novel-credits-model.ts";
import { DEFAULT_APP_I18N_SETTINGS } from "../../src/shared/i18n.ts";
import { createApplication } from "../support/create-test-application.ts";

test("public benefits use the actual weekly quota and distinguish tiers without review claims", () => {
  const catalog = buildAiNovelBillingCatalog({accountRegion: "CN", platform: "web", distribution: "web", locale: "zh-CN"});
  for (const product of catalog.products) {
    assert.deepEqual(product.usage, {credits: LOCAL_CREDIT_QUOTAS[product.tier], resetPeriod: "P7D"});
    assert.equal(product.benefits?.[0].text, `每周享有 ${LOCAL_CREDIT_QUOTAS[product.tier]} credits（${LOCAL_CREDIT_QUOTAS[product.tier] / LOCAL_CREDIT_QUOTAS.free}X 免费额度）`);
    assert.equal(product.benefits?.some(b => /审校|每月|tokens/.test(b.text)), false);
    assert.equal(product.benefits?.find(b => b.key === "sync")?.comingSoon, true);
    assert.match(product.benefits!.find(b => b.key === "sync")!.text, /即将推出/);
  }
  const pro = catalog.products.find(p => p.tier === "pro")!.benefits!;
  assert.equal(pro.find(b => b.key === "priority")!.text, "高峰期极速响应");
  assert.equal(pro.find(b => b.key === "base")!.text, "包含 Plus 的所有权益");
  assert.match(pro.find(b => b.key === "models")!.text, /最新、最强/);
  assert.match(pro.find(b => b.key === "memory")!.text, /更大记忆/);
  assert.equal(Object.hasOwn(catalog, "locale"), false);
});

test("configuration controls text, order and inclusion, preserving canonical quotas", () => {
  const config = JSON.stringify({plus: [
    {key: "later", text: {"en-US": "Later", "zh-CN": "稍后"}, included: false, order: 2, comingSoon: false},
    {key: "first", text: {"en-US": "First {credits}"}, included: true, order: 1, comingSoon: true},
  ]});
  assert.deepEqual(billingBenefits("plus", "zh-CN", config).map(b => [b.key, b.text, b.included]),
    [["first", "First 1000", true], ["later", "稍后", false]]);
  assert.equal(billingBenefits("pro", "en-US", config).length, 6);
  assert.throws(() => parseBillingBenefitsConfig('{"plus":[{}]}'));
});

test("every supported locale has complete copy and substituted allowances", () => {
  for (const locale of DEFAULT_APP_I18N_SETTINGS.supportedLocales) {
    for (const tier of ["plus", "pro"] as const) {
      const benefits = billingBenefits(tier, locale);
      assert.equal(benefits.length, 6);
      assert.equal(benefits.every(b => b.text.length > 0 && !b.text.includes("{credits}")), true);
      assert.equal(benefits[0].text.includes(String(LOCAL_CREDIT_QUOTAS[tier])), true);
      if (locale !== "en-US") assert.notEqual(benefits[0].text, billingBenefits(tier, "en-US")[0].text);
    }
  }
});

test("guest catalog reuses request locale precedence, fallback and app config", async () => {
  const runtime = await createApplication();
  const request = (headers: Record<string, string>, locale?: string) => runtime.app.handle({method: "GET",
    path: "/api/v1/ai_novel/billing/catalog", headers: {"x-app-id": "ai_novel", ...headers},
    query: {platform: "web", distribution: "web", ...(locale ? {locale} : {})}});
  const chinese = await request({"x-app-locale": "zh-CN", "accept-language": "en-US"});
  assert.equal(chinese.statusCode, 200);
  assert.equal(chinese.body.data.products[0].benefits[0].text, "每周享有 1000 credits（5X 免费额度）");
  const english = await request({"x-app-locale": "zh-CN"}, "en-US");
  assert.equal(english.body.data.products[0].benefits[0].text, "1000 credits every week (5X the Free allowance)");
  const traditional = await request({"accept-language": "zh-HK"});
  assert.equal(traditional.body.data.products[0].benefits[0].text, "每週享有 1000 credits（5X 免費額度）");
  await runtime.database.upsertAppConfig({id: "benefits_test", appId: "ai_novel", configKey: BILLING_BENEFITS_CONFIG_KEY,
    configValue: JSON.stringify({plus: [{key: "custom", text: {"zh-CN": "配置下发"}, included: false, order: 1, comingSoon: false}]}),
    updatedAt: new Date().toISOString()});
  const custom = await request({"x-app-locale": "zh-CN"});
  assert.equal(custom.body.data.products[0].benefits[0].text, "配置下发");
  assert.equal(custom.body.data.products[0].benefits[0].included, false);
});
