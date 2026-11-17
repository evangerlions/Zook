import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import * as model from '../../apps/admin-web/app/lib/billing-revenue-model.ts';

test('daily chart tooltip shows all metrics and distribution lists amounts and percentages', async () => {
  const ts = createRequire(new URL('../../apps/admin-web/package.json', import.meta.url))('typescript');
  const source = await readFile(new URL('../../apps/admin-web/app/components/billing-revenue-charts.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const jsx = (type: any, props: any) => ({ type, props });
  const modules: Record<string, any> = {
    react: { useState: (value: unknown) => [value, () => {}], useMemo: (fn: any) => fn() },
    'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Card: 'Card', Col: 'Col', Empty: 'Empty', Radio: { Group: 'Radio' }, Row: 'Row', Statistic: 'Statistic' },
    '../lib/billing-revenue-model': model, '../lib/billing-format': { formatBillingMoney: (v: number) => `¥${(v / 100).toFixed(2)}` }, './llm-monitor/llm-chart': { LlmChart: 'Chart' },
  };
  const exports: any = {}; runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  const row = { date: '2026-11-01', appId: 'ai_novel', productKey: 'plus', source: 'alipay', market: null, currency: 'CNY', purchaseCount: 2, grossMinor: 200, refundMinor: 50 };
  const tree = exports.BillingRevenueCharts({ data: { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' }, rows: [row], currency: 'CNY' });
  const find = (node: any, type: any): any => {
    if (Array.isArray(node)) return node.map(item => find(item, type)).find(Boolean);
    if (!node || typeof node !== 'object') return undefined;
    return node.type === type ? node : find(node.props?.children, type);
  };
  const daily = find(tree, 'Chart');
  const tooltip = daily.props.option.tooltip.formatter([{ dataIndex: 0 }]);
  assert.match(tooltip, /购买金额：¥2\.00/); assert.match(tooltip, /退款金额：¥0\.50/); assert.match(tooltip, /付费交易数：2/);
  const cards = tree.props.children[3].props.children;
  const distribution = cards[0].props.children.props.children;
  const rendered = distribution.type(distribution.props);
  const text = JSON.stringify(rendered);
  assert.match(text, /ai_novel/); assert.match(text, /¥2\.00/); assert.match(text, /100\.0/);
});
