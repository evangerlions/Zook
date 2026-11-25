import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { BrowserLoginSession } from "../../src/modules/billing-accounts/manual/browser-session.ts";
import { providerPages } from "../../src/modules/billing-accounts/manual/provider-pages.ts";

const quotaPage = providerPages["agent-plan"].url;
const fiveHours = '<div role="progressbar" aria-label="近5小时用量" aria-valuenow="4.655028" aria-valuetext="4.66%"></div>';
const week = '<div role="progressbar" aria-label="近一周用量" aria-valuenow="100"></div>';
const month = '<div role="progressbar" aria-label="近一月用量" aria-valuetext="0%"></div>';

test("manual Agent Plan browser session reads exactly one value for each official quota window", async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route(quotaPage, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: fiveHours + week + month }));
    await page.goto(quotaPage);

    const session = new BrowserLoginSession("session", "account", "operator", "agent-plan", browser, context, page, Date.now() + 60000);
    const sample = await session.read();
    assert.equal(sample.status, "ok");
    assert.deepEqual(sample.metrics.map(({ kind, remaining, scope, unit }) => [kind, remaining?.toFixed(2), scope, unit]), [
      ["agent_plan_5h_remaining", "95.34", "personal", "%"],
      ["agent_plan_weekly_remaining", "0.00", "personal", "%"],
      ["agent_plan_monthly_remaining", "100.00", "personal", "%"],
    ]);

    for (const invalid of [fiveHours + week, fiveHours + week + month + month, fiveHours + week.replace("100", "101") + month]) {
      await page.setContent(invalid);
      const badSample = await session.read();
      assert.equal(badSample.status, "error");
      assert.deepEqual(badSample.metrics, []);
    }

    await page.goto("about:blank");
    await assert.rejects(session.read(), { statusCode: 409 });
  } finally {
    await browser.close();
  }
});
