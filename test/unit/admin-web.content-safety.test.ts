import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

// The admin app has no DOM test runner. Transpile the real TSX in memory and
// exercise its controlled widget callbacks without substituting the components.
const require = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
const ts = require("typescript");
function componentModule(file: string, overrides: Record<string, string> = {}): string {
  const code = ts.transpileModule(source(file), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from "([^"]+)"/g, (_match: string, module: string) => {
    const url = overrides[module] ?? (module === "./field" ? componentModule("field.tsx") :
      module === "./metric-card" ? componentModule("metric-card.tsx") :
      module === "./content-safety-stats-charts" ? componentModule("content-safety-stats-charts.tsx") :
      module === "./content-safety-stats-view-model" ? componentModule("content-safety-stats-view-model.ts") :
      module === "./llm-monitor/llm-chart" ? componentModule("llm-monitor/llm-chart.tsx") :
      new URL("file://" + require.resolve(module)).href);
    return 'from "' + url + '"';
  });
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}

const source = (file: string) => readFileSync(new URL("../../apps/admin-web/app/components/" + file, import.meta.url), "utf8");

test("safety admin offers Jev toggle without replacing the stored Qwen key or disabling Aliyun", () => {
  const view = source("content-safety-providers-tab.tsx");
  assert.match(view, /checked={draft.llm.useJev === true}/);
  assert.match(view, /llm: { \.\.\.current.llm, useJev }/);
  assert.match(view, /value={draft.llm.modelKey}/);
  const aliyun = view.slice(view.indexOf('<h3>阿里云内容安全'));
  assert.ok(!aliyun.includes("useJev"));
});

test("statistics widget loads on entry, avoids duplicate requests and reloads on reentry", async () => {
  // Execute the actual widget with a deterministic hook lifecycle and deferred
  // API. No DOM runner is installed in this app.
  let slots: any[] = [], cursor = 0;
  const effects: Array<() => void> = [];
  const requests: Array<{ query: any; resolve: (value: any) => void }> = [];
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = value; }];
    },
    useRef(initial: any) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useEffect(callback: () => void) {
      const index = cursor++;
      if (!(index in slots)) { slots[index] = true; effects.push(callback); }
    },
  };
  const scope = globalThis as any;
  scope.__statsWidgetTest = { hooks, fetch: (query: any) => new Promise(resolve => requests.push({ query, resolve })) };
  const moduleUrl = (code: string) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  const overrides = {
    react: moduleUrl("export const {useState,useRef,useEffect}=globalThis.__statsWidgetTest.hooks;"),
    "../lib/admin-api": moduleUrl("export const adminApi={getContentSafetyStats:(query)=>globalThis.__statsWidgetTest.fetch(query)};"),
    "../lib/admin-session": moduleUrl("export const useAdminSession=()=>({clearNotice(){},setNotice(){}});"),
    "../lib/format": moduleUrl("export const formatApiError=String;export const makeNotice=(type,message)=>({type,message});"),
  };
  try {
    const { ContentSafetyStatsTab } = await import(componentModule("content-safety-stats-tab.tsx", overrides));
    const render = () => { cursor = 0; return ContentSafetyStatsTab(); };
    const flatten = (tree: any): any[] => !tree || typeof tree !== "object" ? [] :
      [tree, ...[tree.props?.children].flat(Infinity).flatMap(flatten)];
    const queryButton = (tree: any) => flatten(tree).find(item => item.props?.children === "查询");
    render();
    assert.equal(requests.length, 0);
    effects[0]();
    effects[0](); // StrictMode effect replay must not duplicate the in-flight query.
    queryButton(render()).props.onClick();
    assert.equal(requests.length, 1);
    assert.deepEqual(Object.keys(requests[0].query).sort(), ["dateFrom", "dateTo"]);
    const stats = { summary: { total: 4056, successful: 4042, passed: 3928, blocked: 114, blockRate: 0.028,
      failedOpen: 14, failedOpenRate: 0.0035 }, daily: [], byCategory: [], byModel: [] };
    requests[0].resolve(stats);
    await new Promise(resolve => setImmediate(resolve));
    const cards = flatten(render()).filter(item => item.props?.label);
    assert.equal(cards.find(item => item.props.label === "失败默认放行率")?.props.value, "0.4%");
    assert.equal(cards.find(item => item.props.label === "失败默认放行次数")?.props.value, "14");
    render();
    assert.equal(requests.length, 1); // Ordinary renders don't poll.
    slots = []; effects.length = 0; // Parent removes the tab, then mounts it again.
    render(); effects[0]();
    assert.equal(requests.length, 2);
    requests[1].resolve(stats);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    delete scope.__statsWidgetTest;
  }
});

test("statistics UI only submits date filters and displays Redis counts", () => {
  const view = source("content-safety-stats-tab.tsx");
  assert.match(view, /getContentSafetyStats\({\s*\.\.\.getDateRange\(range\),\s*}\)/);
  assert.match(view, /if \(querying.current\) return;/);
  assert.match(view, /Date.now\(\) \+ 8 \* 60 \* 60 \* 1000/);
  for (const field of ["total", "successful", "blocked", "failedOpen"]) assert.ok(view.includes("stats.summary." + field));
  for (const field of ["bySource", "byTaskType", "byApp", "p95LatencyMs", "avgLatencyMs"]) assert.ok(!view.includes(field));
  assert.match(view, /<ContentSafetyStatsCharts stats={stats}/);
  assert.ok(!view.includes("Fail-open"));
  assert.match(view, /label="失败默认放行率"/);
  assert.match(view, /label="失败默认放行次数"/);
  assert.match(view, /useEffect\(\(\) => {\s*void loadStats\(\);\s*}, \[\]\)/);
});

test("real moderation widget toggles Jev both ways, preserves Qwen, and disables only the model input", async () => {
  const { ContentSafetyProvidersTab } = await import(componentModule("content-safety-providers-tab.tsx"));
  let draft = { llm: { enabled: true, modelKey: "qwen3.6-flash", timeoutMs: 5000, useJev: false },
    aliyun: { enabled: true, endpoint: "https://green.example.test", region: "cn-shanghai", service: "test", timeoutMs: 5000 } };
  const render = () => ContentSafetyProvidersTab({ draft, passwordOptions: [], onDraftChange: (update: any) => { draft = update(draft); } });
  const findField = (tree: any, label: string): any => {
    if (!tree || typeof tree !== "object") return undefined;
    if (tree.props?.label === label) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) {
      const found = findField(child, label);
      if (found) return found;
    }
  };
  const toggle = findField(render(), "使用 Jev 审核").props.children[0];
  assert.equal(toggle.props.checked, false);
  toggle.props.onChange(true);
  assert.equal(draft.llm.useJev, true);
  assert.equal(draft.llm.modelKey, "qwen3.6-flash");
  assert.equal(findField(render(), "原有 LLM Model Key").props.children.props.disabled, true);
  assert.equal(findField(render(), "Endpoint").props.children.props.disabled, undefined);
  findField(render(), "使用 Jev 审核").props.children[0].props.onChange(false);
  assert.equal(draft.llm.modelKey, "qwen3.6-flash");
  assert.equal(findField(render(), "原有 LLM Model Key").props.children.props.disabled, false);
});

const chartStats = () => ({
  timezone: "Asia/Shanghai", storage: "redis", summary: {
    total: 105, successful: 90, passed: 80, blocked: 10, failedOpen: 10,
    blockRate: 10 / 105, failedOpenRate: 10 / 105,
  },
  daily: [
    { date: "2026-10-09", total: 65, successful: 50, passed: 45, blocked: 5, failedOpen: 10 },
    { date: "2026-10-08", total: 40, successful: 40, passed: 35, blocked: 5, failedOpen: 0 },
  ],
  byCategory: [
    { key: "geopolitics", count: 3, successful: 3, passed: 0, blocked: 3, failedOpen: 0 },
    { key: "自定义规则", count: 7, successful: 7, passed: 0, blocked: 7, failedOpen: 0 },
  ],
  byModel: [
    { key: "jev", count: 100, successful: 90, passed: 80, blocked: 10, failedOpen: 10 },
    { key: "future-model", count: 0, successful: 0, passed: 0, blocked: 0, failedOpen: 0 },
  ],
});

test("chart presentation excludes unfinished requests and preserves unknown categories/models", async () => {
  const vm = await import(componentModule("content-safety-stats-view-model.ts"));
  const stats = chartStats();
  const view = vm.safetyStatsPresentation(stats);
  assert.equal(view.completed, 100);
  assert.equal(view.pending, 5);
  assert.deepEqual(view.outcomes.map((item: any) => item.value), [80, 10, 10]);
  assert.deepEqual(view.categories.map((item: any) => item.label), ["自定义规则", "地缘政治"]);
  assert.equal(view.models[0].label, "Jev");
  assert.equal(view.models[0].failedOpenRate, 0.1);
  assert.equal(view.models[1].label, "future-model");
  assert.equal(view.models[1].blockRate, 0);
  assert.equal(view.models[1].failedOpenRate, 0);
  assert.equal(stats.byCategory[0].key, "geopolitics"); // Mapper doesn't mutate the API response.
});

test("chart options use consistent outcome colors, ordered dates and descending block counts", async () => {
  const vm = await import(componentModule("content-safety-stats-view-model.ts"));
  const stats = chartStats();
  const pie = vm.buildSafetyPie(stats), trend = vm.buildSafetyTrend(stats), categories = vm.buildSafetyCategories(stats);
  assert.equal(pie.series[0].stillShowZeroSum, false);
  assert.equal(pie.legend.formatter("通过"), "通过  80 次（80.0%）");
  assert.equal(pie.series[0].data.reduce((sum: number, item: any) => sum + item.value, 0), 100);
  assert.deepEqual(trend.xAxis.data, ["10-08", "10-09"]);
  assert.deepEqual(trend.series.map((item: any) => item.data), [[35, 45], [5, 5], [0, 10]]);
  assert.deepEqual(trend.series.map((item: any) => item.itemStyle.color), pie.series[0].data.map((item: any) => item.itemStyle.color));
  assert.ok(trend.series.every((item: any) => item.stack === "completed"));
  assert.deepEqual(categories.series[0].data, [7, 3]);
  assert.equal(categories.yAxis.inverse, true);
  assert.equal(categories.tooltip.renderMode, "richText"); // Custom labels aren't injected as HTML.
  assert.equal(stats.daily[0].date, "2026-10-09");
});

test("real ECharts renders all safety chart options without a browser or network", async () => {
  const echarts = require("echarts");
  const vm = await import(componentModule("content-safety-stats-view-model.ts"));
  for (const build of [vm.buildSafetyPie, vm.buildSafetyTrend, vm.buildSafetyCategories]) {
    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 480, height: 320 });
    try {
      chart.setOption({ ...build(chartStats()), animation: false });
      const svg = chart.renderToSVGString();
      assert.match(svg, /<svg/);
      assert.ok(!svg.includes("NaN"));
      assert.ok(!svg.includes("Infinity"));
      assert.match(svg, /<path/);
    } finally {
      chart.dispose();
    }
  }
});

test("statistics charts render empty states and collapsed details without extra API calls", async () => {
  const { ContentSafetyStatsCharts } = await import(componentModule("content-safety-stats-charts.tsx"));
  const flatten = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(flatten) :
    !tree || typeof tree !== "object" ? [] : [tree, ...flatten(tree.props?.children)];
  const stats = chartStats();
  const elements = flatten(ContentSafetyStatsCharts({ stats }));
  assert.equal(elements.filter(item => item.props?.option).length, 3);
  assert.ok(elements.some(item => item.props?.role === "status"));
  const collapse = elements.find(item => item.props?.items);
  assert.equal(collapse.props.items[0].label, "每日明细");
  assert.equal(collapse.props.defaultActiveKey, undefined);
  assert.equal(collapse.props.activeKey, undefined);
  const empty = { ...stats, summary: { ...stats.summary, total: 0, successful: 0, passed: 0, blocked: 0, failedOpen: 0 }, byCategory: [], byModel: [], daily: [] };
  const emptyElements = flatten(ContentSafetyStatsCharts({ stats: empty }));
  assert.equal(emptyElements.filter(item => item.props?.option).length, 0);
  assert.equal(emptyElements.filter(item => item.props?.description === "暂无已完成审核").length, 2);
  assert.ok(!emptyElements.some(item => item.props?.role === "status"));
  assert.ok(!source("content-safety-stats-charts.tsx").includes("adminApi"));
  assert.match(source("llm-monitor/llm-chart.tsx"), /charts.PieChart/);
});
