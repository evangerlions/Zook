import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chromium", headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(5000); const saved: any[] = [];
  const accounts = [{ id: "main", name: "主账号", type: "openrouter", providers: ["openrouter"], mode: "automatic", alerts: false, warning: 20, critical: 5, credentialConfigured: true, alert: { level: "healthy" } }];
  const providerOptions = [
    { key: "openrouter", label: "Primary", accountType: "openrouter" },
    { key: "OPENROUTER_BACKUP", label: "Backup", accountType: "openrouter" },
    { key: "spare", label: "Spare", accountType: "openrouter" },
    { key: "bai", label: "B.AI", accountType: "bai" },
  ];
  const envelope = (data: unknown) => ({ code: "OK", message: "OK", data, requestId: "provider-select-fixture" });
  await page.route("**/api/v1/admin/billing-accounts", async route => {
    if (route.request().method() === "POST") { const body = route.request().postDataJSON(); saved.push(body); await route.fulfill({ json: envelope(body) }); }
    else await route.fulfill({ json: envelope({ accounts, providerOptions, config: { intervalMinutes: 5, warningRepeatHours: 24, criticalRepeatHours: 4, failureCount: 3, recoverySamples: 2, rules: [] } }) });
  });
  await page.goto("http://127.0.0.1:3197/login");
  await page.getByRole("textbox", { name: "admin", exact: true }).fill("feishu-local");
  await page.getByRole("textbox", { name: "输入密码", exact: true }).fill("local-acceptance-only");
  await page.getByRole("button", { name: "进入后台" }).click(); await page.waitForURL("**/apps");
  await page.goto("http://127.0.0.1:3197/balance-accounts");
  await page.getByRole("button", { name: "新增账号", exact: true }).click();
  const select = page.getByRole("combobox", { name: "关联 LLM Provider", exact: true });
  await select.waitFor({ timeout: 3000 });
  await page.getByLabel("账号名称", { exact: true }).fill("Backup billing");
  await select.click();
  assert.equal(await page.getByRole("option").filter({ hasText: "已关联 主账号" }).getAttribute("aria-disabled"), "true");
  assert.equal(await page.getByRole("option").filter({ hasText: "B.AI" }).count(), 0, "Only matching provider types should be listed");
  await select.fill("BACKUP");
  await page.getByRole("option").filter({ hasText: "Backup" }).click();
  await select.press("Escape");
  await page.getByLabel("Management Key", { exact: true }).fill("fixture-management-key");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(saved[0].providers, ["OPENROUTER_BACKUP"]);
  await page.getByRole("row").filter({ hasText: "主账号" }).getByRole("button", { name: /^编\s*辑$/ }).click();
  await select.click();
  assert.notEqual(await page.getByRole("option").filter({ hasText: "Primary" }).getAttribute("aria-disabled"), "true", "Editing must keep the current owner's provider selectable");
  await select.press("Escape"); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "新增账号", exact: true }).click();
  await page.getByLabel("账号名称", { exact: true }).fill("Bai billing");
  await select.click(); await page.getByRole("option").filter({ hasText: "Spare" }).click(); await select.press("Escape");
  await page.getByRole("combobox", { name: /服务商/ }).click();
  await page.getByRole("combobox", { name: /服务商/ }).press("ArrowDown");
  await page.getByRole("combobox", { name: /服务商/ }).press("Enter");
  assert.equal(await page.locator('.ant-select-selection-item').filter({ hasText: "Spare" }).count(), 0, "Changing service must clear incompatible provider selection");
  await select.click(); await page.getByRole("option", { name: "B.AI（bai）", exact: true }).click(); await select.press("Escape");
  await page.getByText("复用关联 LLM Provider 的密钥", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("API Key", { exact: true }).count(), 0);
  console.log("Billing provider select: search, type filtering, occupied/own links, array payload, type-change reset and B.AI key reuse passed.");
} finally { await browser.close(); }
