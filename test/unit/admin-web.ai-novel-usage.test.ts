import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  usageChartOptions,
  replayResult,
} from "../../apps/admin-web/app/lib/ai-novel-usage-charts.ts";
import { buildUsageReport } from "../../src/modules/admin/ai-novel-usage-report.ts";
import { usageFilter } from "../../src/services/ai-novel-usage-admin.service.ts";

test("chart calendar includes gaps without fabricating payment or consumption zeros; no-window distribution is null", () => {
  const report = buildUsageReport(
    {
      events: [],
      windows: [],
      accounts: [],
      reportingSince: null,
      payments: [
        {
          userId: "a",
          at: "2026-10-05T00:00:00.000Z",
          kind: "purchase",
          currency: "CNY",
          amountMinor: 100,
          sandbox: false,
          tier: "plus",
        },
        {
          userId: "a",
          at: "2026-10-10T00:00:00.000Z",
          kind: "purchase",
          currency: "CNY",
          amountMinor: 200,
          sandbox: false,
          tier: "plus",
        },
      ],
    },
    usageFilter({ days: "7" }, new Date("2026-10-11T08:00:00.000Z")),
  );
  const options = usageChartOptions(report, "CNY");
  const axis = options[0]!.option.xAxis as { data: string[] };
  assert.equal(axis.data.length, 7);
  const finance = options[0]!.option.series as {
    data: (number | null)[];
    connectNulls: boolean;
  }[];
  assert.deepEqual(finance[0]!.data, [1, null, null, null, null, 2, null]);
  assert.equal(finance[0]!.connectNulls, false);
  assert.equal(finance.length, 1, "refunds belong in the final table, not the payment trend");
  assert.equal(options[0]!.title, "支付趋势 · CNY");
  const distribution = options[2]!.option.series as {
    data: (number | null)[];
  }[];
  assert.deepEqual(distribution[0]!.data, [null, null, null]);
});

test("simulation copy explains weekly samples; refunds render after user analysis", async () => {
  const base = "../../apps/admin-web/app/components/ai-novel-usage/";
  const read = (file: string) => readFile(new URL(base + file, import.meta.url), "utf8");
  const replay = await read("usage-replay.tsx");
  assert.match(replay, /每周额度调整模拟/);
  assert.match(replay, /每个样本是一个完整的用户周周期/);
  assert.match(replay, /仅模拟，不修改真实额度/);
  assert.doesNotMatch(replay, /调额重放|恢复当前额度/);
  const overview = await read("usage-overview.tsx");
  assert.ok(overview.indexOf("<UsageRefunds") > overview.indexOf("<UsageUserSection"));
  const refunds = await read("usage-refunds.tsx");
  assert.match(refunds, /row\.refundMinor > 0/);
  assert.match(refunds, /不是逐笔退款明细/);
  assert.match(refunds, /pageSize: 10/);
});

test("replay handles empty, exact limit and lower/greater quota without applying changes", () => {
  assert.deepEqual(replayResult([], 1000, 1000), {
    hits: 0,
    total: 0,
    percent: null,
    change: 0,
  });
  assert.deepEqual(replayResult([500, 1000, 1100], 1000, 1000), {
    hits: 2,
    total: 3,
    percent: (1 - 2 / 3) * 100,
    change: 0,
  });
  assert.equal(replayResult([500, 1000, 1100], 2000, 1000).change, -2);
  assert.equal(replayResult([500, 1000, 1100], 250, 1000).change, 1);
});

test("usage table cannot expand its narrow-screen grid host; correction remains scoped to Usage", async () => {
  const css = await readFile(new URL("../../apps/admin-web/app/components/ai-novel-usage/usage.css", import.meta.url), "utf8");
  assert.match(css, /\.page-shell:has\(\.usage-page\)\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/);
  assert.match(css, /\.usage-page\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /\.usage-page \.stack\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
});
