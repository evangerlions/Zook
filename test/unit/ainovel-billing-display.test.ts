import assert from "node:assert/strict";
import test from "node:test";
import { billingDisplay, billingCheckoutDisplay, billingAmountText } from "../../src/modules/billing/ainovel-billing-display.ts";
import { buildAiNovelBillingCatalog } from "../../src/modules/billing/ainovel-billing-catalog.ts";
import { createApplication } from "../support/create-test-application.ts";
import { BILLING_BENEFITS_CONFIG_KEY } from "../../src/modules/billing/ainovel-billing-benefits.ts";

const copy = { "zh-CN": "服务端完整文字", "en-US": "Complete server copy" };
const config = JSON.stringify({ display: { title: copy, agreement: copy, plusLabel: copy },
  products: { plus_monthly: { displayName: copy, periodLabel: copy, badgeText: copy } },
  checkoutDisplay: { title: copy, hint: copy, waiting: copy } });

test("localized optional copy defaults to null and uses existing locale fallback", () => {
  const empty = billingDisplay().product("pro_yearly");
  assert.deepEqual(empty, { displayName: null, periodLabel: null, badgeText: null });
  assert.equal(billingDisplay("zh-CN", config).page.title, "服务端完整文字");
  assert.equal(billingDisplay("fr-FR", config).product("plus_monthly").periodLabel, "Complete server copy");
  assert.equal(billingCheckoutDisplay("plus_monthly", "zh-CN", config).productName, "服务端完整文字");
  assert.equal(billingDisplay("zh-CN", '{"display":{"title":{"zh-CN":" "}}}').page.title, null);
  assert.throws(() => billingDisplay("zh-CN", '{"products":{"plus_monthly":{"badgeText":false}}}').product("plus_monthly"));
});

test("catalog display cannot change money, product identity or availability", () => {
  const catalog = buildAiNovelBillingCatalog({ accountRegion: "CN", platform: "web", distribution: "web",
    locale: "zh-CN", benefitsConfig: config, alipayAvailable: true,
    alipayPrices: Object.fromEntries(["plus", "pro"].flatMap(tier => ["monthly", "quarterly", "yearly"].map(period => [`${tier}_${period}`, 3800]))) });
  assert.equal(catalog.display!.title, "服务端完整文字");
  assert.equal(catalog.products[0].displayName, "服务端完整文字");
  assert.equal(catalog.products[0].productKey, "plus_monthly");
  assert.equal(catalog.products[0].providers[0].price!.amountMinor, 3800);
  assert.equal(catalog.products[0].providers[0].price!.localizedDisplay, billingAmountText(3800, "zh-CN"));
  assert.equal(catalog.products[1].badgeText, null);
});

test("guest catalog applies and clears presentation through the existing endpoint", async () => {
  const runtime = await createApplication();
  const save = (configValue: string) => runtime.database.upsertAppConfig({ id: "display_test", appId: "ai_novel",
    configKey: BILLING_BENEFITS_CONFIG_KEY, configValue, updatedAt: new Date().toISOString() });
  const get = () => runtime.app.handle({ method: "GET", path: "/api/v1/ai_novel/billing/catalog",
    headers: { "x-app-locale": "zh-CN" }, query: { platform: "web", distribution: "web" } });
  await save(config);
  const response = await get();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.display.title, "服务端完整文字");
  assert.equal(response.body.data.products[0].badgeText, "服务端完整文字");
  await save("{}");
  assert.equal((await get()).body.data.display.title, null);
  assert.equal((await get()).body.data.products[0].badgeText, null);
});

test("Alipay prices use a narrow currency symbol in every locale without changing the amount", () => {
  for (const [locale, expected] of [
    ["en-US", "¥38.00"], ["zh-CN", "¥38.00"], ["zh-TW", "¥38.00"],
    ["ja-JP", "￥38.00"], ["de-DE", "38,00 ¥"], ["fr-FR", "38,00 ¥"],
  ]) {
    assert.equal(billingAmountText(3800, locale), expected, locale);
  }
  assert.equal(billingAmountText(123456, "en-US"), "¥1,234.56");
  assert.equal(billingAmountText(0, "en-US"), "¥0.00");
  assert.equal(billingAmountText(3801, "en-US"), "¥38.01");
});

test('catalog delivers configurable initial selection with safe default', async () => {
  const runtime = await createApplication();
  const save = (value: string) => runtime.database.upsertAppConfig({
    id: 'default_selection_test', appId: 'ai_novel', configKey: BILLING_BENEFITS_CONFIG_KEY,
    configValue: value, updatedAt: new Date().toISOString(),
  });
  const get = () => runtime.app.handle({ method: 'GET', path: '/api/v1/ai_novel/billing/catalog', headers: {},
    query: { platform: 'web', distribution: 'web' } });
  assert.equal((await get()).body.data.display.defaultProductKey, 'plus_monthly');
  await save(JSON.stringify({ display: { defaultProductKey: 'pro_yearly' } }));
  assert.equal((await get()).body.data.display.defaultProductKey, 'pro_yearly');
  await save(JSON.stringify({ display: { defaultProductKey: 'unknown' } }));
  assert.equal((await get()).body.data.display.defaultProductKey, 'plus_monthly');
});

test('catalog emits optional payment agreement URLs and rejects unsafe schemes', async () => {
  const runtime = await createApplication();
  const save = (display: object) => runtime.database.upsertAppConfig({
    id: 'agreement_urls_test', appId: 'ai_novel', configKey: BILLING_BENEFITS_CONFIG_KEY,
    configValue: JSON.stringify({ display }), updatedAt: new Date().toISOString(),
  });
  const get = () => runtime.app.handle({ method: 'GET', path: '/api/v1/ai_novel/billing/catalog',
    headers: {}, query: { platform: 'web', distribution: 'web' } });
  const initial = (await get()).body.data.display;
  assert.equal(initial.paidServiceUrl, null);
  assert.equal(initial.debitAuthorizationUrl, null);
  await save({ paidServiceUrl: 'https://example.com/paid', debitAuthorizationUrl: 'https://example.com/debit' });
  const configured = (await get()).body.data.display;
  assert.equal(configured.paidServiceUrl, 'https://example.com/paid');
  assert.equal(configured.debitAuthorizationUrl, 'https://example.com/debit');
  await save({ paidServiceUrl: 'javascript:alert(1)', debitAuthorizationUrl: 'not a url' });
  const invalid = (await get()).body.data.display;
  assert.equal(invalid.paidServiceUrl, null);
  assert.equal(invalid.debitAuthorizationUrl, null);
});
