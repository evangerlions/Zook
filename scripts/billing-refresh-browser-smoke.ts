import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chromium", headless: true, chromiumSandbox: true });
let release!: () => void;
let releaseRead!: () => void;
let releaseHung!: () => void;
try {
  const page = await browser.newPage();
  const calls: string[] = []; let holdA = true; let failA = false; let reads = 0; let balanceB = 127.51546325;
  let delayRead = false; let holdReads = false; let captured!: () => void;
  const readCaptured = new Promise<void>(resolve => { captured = resolve; });
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  const hungGate = new Promise<void>(resolve => { releaseHung = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const accounts = [
    { id: "A", name: "Auto A", type: "openrouter", mode: "automatic", sample: { status: "ok", stale: false, metrics: [{ remaining: 22.544710299999906, unit: "USD" }] } },
    { id: "M", name: "Manual M", type: "geyan", mode: "manual" },
    { id: "B", name: "Auto B", type: "bai", mode: "automatic" },
  ].map(a => ({ ...a, providers: [], alerts: false, warning: 20, critical: 5, credentialConfigured: true, alert: { level: "healthy" } }));
  const envelope = (data: unknown) => ({ code: "OK", message: "OK", data, requestId: "billing-refresh-fixture" });
  await page.route("**/api/v1/admin/billing-accounts**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/refresh")) {
      const id = path.split("/").at(-2)!; calls.push(id);
      if (id === "B") balanceB++;
      if (id === "A" && holdA) await gate;
      await route.fulfill({ json: envelope({ status: id === "A" && failA ? "error" : "ok", detail: id === "A" && failA ? "Fixture upstream failed" : undefined, metrics: [] }) });
    } else {
      reads++;
      const snapshot = { accounts: accounts.map(a => a.id === "B" ? { ...a, sample: { status: "ok", stale: false, metrics: [{ remaining: balanceB, unit: "USD" }] } } : a), config: { intervalMinutes: 5, warningRepeatHours: 24, criticalRepeatHours: 4, failureCount: 3, recoverySamples: 2, rules: [] } };
      if (delayRead) { delayRead = false; captured(); await readGate; }
      if (holdReads) await hungGate;
      await route.fulfill({ json: envelope(snapshot) }).catch(() => {});
    }
  });
  await page.goto("http://127.0.0.1:3197/login");
  await page.getByRole("textbox", { name: "admin", exact: true }).fill("feishu-local");
  await page.getByRole("textbox", { name: "输入密码", exact: true }).fill("local-acceptance-only");
  await page.getByRole("button", { name: "进入后台" }).click();
  await page.waitForURL("**/apps"); await page.goto("http://127.0.0.1:3197/balance-accounts");
  const row = (name: string) => page.getByRole("row").filter({ hasText: name });
  const refresh = (name: string) => row(name).getByRole("button", { name: /刷新余额/ });
  await row("Auto A").getByText("22.54 USD", { exact: true }).waitFor();
  await row("Auto B").getByText("127.52 USD", { exact: true }).waitFor();
  await refresh("Auto A").click();
  await row("Auto A").locator('button .anticon-loading').waitFor();
  assert.equal(await row("Auto B").locator('button .anticon-loading').count(), 0, "Unrelated automatic row must not spin");
  assert.equal(await row("Manual M").locator('button .anticon-loading').count(), 0, "Manual row must not spin");
  assert.deepEqual(calls, ["A"]);
  holdA = false; release();
  await page.getByRole("button", { name: /全部刷新/ }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('button .anticon-loading'));
  calls.length = 0; failA = true;
  await page.getByRole("button", { name: /全部刷新/ }).click();
  await page.getByRole("alert").filter({ hasText: /Auto A/ }).waitFor();
  assert.deepEqual(calls, ["A", "B"], "Bulk refresh must continue after provider error and exclude manual accounts");
  assert.match(await page.getByRole("alert").filter({ hasText: /Auto A/ }).innerText(), /1.*失败/);
  await page.waitForFunction(() => !document.querySelector('button .anticon-loading'));
  const before = calls.length; const readsBefore = reads;
  const reload = page.waitForResponse(r => r.url().endsWith("/api/v1/admin/billing-accounts"));
  await page.getByRole("button", { name: "刷新展示", exact: true }).click();
  await reload;
  assert.equal(calls.length, before, "Refresh display must not query upstream providers");
  assert.ok(reads > readsBefore);
  // An older cache response must not overwrite the result of a later row refresh.
  failA = false; delayRead = true;
  await refresh("Auto A").click(); await readCaptured;
  const bResponse = page.waitForResponse(r => r.url().endsWith("/B/refresh"));
  await refresh("Auto B").click(); await bResponse;
  await row("Auto B").getByText(`${balanceB.toFixed(2)} USD`, { exact: true }).waitFor();
  const oldResponse = page.waitForResponse(r => r.url().endsWith("/api/v1/admin/billing-accounts"));
  releaseRead(); await (await oldResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await row("Auto B").getByText(`${balanceB.toFixed(2)} USD`, { exact: true }).count(), 1, "Late older cache response must not overwrite the latest balance");
  // Shorten only the cache deadline to exercise real AbortSignal recovery without a 25s test sleep.
  await page.evaluate(() => { const timeout = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = ms => timeout(ms === 25000 ? 100 : ms); });
  holdReads = true;
  await page.getByRole("button", { name: /全部刷新/ }).click();
  await page.getByRole("alert").filter({ hasText: "加载余额展示失败" }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button .anticon-loading'));
  assert.equal(await page.getByRole("button", { name: /全部刷新/ }).isEnabled(), true, "A hung cache GET must not lock bulk refresh");
  releaseHung();
  console.log("Billing refresh browser regression: row isolation, automatic-only bulk, partial failures, cache-only display, out-of-order responses and timeout recovery passed.");

} finally { release?.(); releaseRead?.(); releaseHung?.(); await browser.close(); }
