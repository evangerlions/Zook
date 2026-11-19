import * as billingTerms from '../../apps/admin-web/app/lib/billing-terms.ts';
import * as revenueModel from '../../apps/admin-web/app/lib/billing-revenue-model.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

test('overview shares filters and summarizes all rows after changing dimensions and currency', async () => {
  const ts = createRequire(new URL('../../apps/admin-web/package.json', import.meta.url))('typescript');
  const source = await readFile(new URL('../../apps/admin-web/app/components/billing-overview-section.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cells: any[] = []; let index = 0; let query: any;
  const rows = Array.from({ length: 52 }, (_, i) => ({ date: '2026-11-01', appId: 'ai_novel', productKey: `product_${i}`, source: 'alipay', market: null, currency: 'CNY', purchaseCount: 1, grossMinor: 100, refundMinor: 10 }));
  rows.push({ ...rows[0], currency: 'USD', grossMinor: 999 });
  const jsx = (type: any, props: any, key?: string) => ({ type, props, key });
  const modules: Record<string, any> = {
    '../lib/billing-terms': billingTerms, '../lib/billing-revenue-model': revenueModel,
    react: { useState: (initial: any) => { const position = index++; if (!(position in cells)) cells[position] = initial; return [cells[position], (value: any) => { cells[position] = value; }]; }, useMemo: (fn: any) => fn() },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    antd: { Alert: 'Alert', Button: 'Button', Select: 'Select', Space: 'Space', Table: Object.assign('Table', { Summary: { Row: 'SummaryRow', Cell: 'SummaryCell' } }), Tabs: 'Tabs', Tag: 'Tag', DatePicker: { RangePicker: 'RangePicker' } },
    '../lib/billing-admin-api': { billingAdminApi: { overview: (value: any) => { query = value; } } },
    '../lib/billing-format': { formatBillingMoney: (value: number, currency: string) => `${currency}:${value}` },
    '../lib/use-billing-query': { useBillingQuery: (load: any) => { load(); return { loading: false, refresh: () => {}, data: { rows, from: '2026-11-01', to: '2026-11-02' } }; } },
    './billing-revenue-charts': { BillingRevenueCharts: 'Charts' },
  };
  const exports: any = {}; runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  const render = () => { index = 0; return exports.BillingOverviewSection({ appId: 'ai_novel', environment: 'SANDBOX' }); };
  const find = (node: any, type: any, predicate = (_: any) => true): any => {
    if (Array.isArray(node)) return node.map(child => find(child, type, predicate)).find(Boolean);
    if (!node || typeof node !== 'object') return undefined;
    return (node.type === type && predicate(node.props) ? node : undefined) || find(node.props?.children, type, predicate) || find(node.props?.items?.map((item: any) => item.children), type, predicate);
  };
  let tree = render();
  assert.equal(query.groupBy, 'appId,productKey,source,market');
  assert.equal(query.environment, 'SANDBOX');
  assert.equal(find(tree, 'Tabs').props.defaultActiveKey, 'charts');
  const dimensionSelect = () => find(tree, 'Select', (p: any) => p['aria-label'] === '收入统计维度');
  dimensionSelect().props.onChange(['appId', 'productKey', 'source', 'market']);
  tree = render(); let table = find(tree, modules.antd.Table);
  assert.equal(table.props.dataSource.length, 52);
  assert.equal(table.props.pagination.pageSize, 50);
  assert.equal(table.props.columns[0].title, '日期（UTC）');
  assert.equal(table.props.columns.find((column: any) => column.dataIndex === 'market').render(null), '未知渠道');
  const summary = table.props.summary();
  assert.equal(summary.props.children[1].props.children, 'CNY:5200');
  assert.equal(summary.props.children[2].props.children, 'CNY:520');
  assert.notEqual(table.props.rowKey(rows[0]), table.props.rowKey(rows[1]));
  find(tree, 'Select', (p: any) => p['aria-label'] === '币种').props.onChange('USD');
  tree = render(); table = find(tree, modules.antd.Table);
  assert.equal(table.props.dataSource.length, 1);
  assert.equal(table.props.summary().props.children[1].props.children, 'USD:999');
  dimensionSelect().props.onChange([]); tree = render();
  assert.equal(find(tree, 'Select', (p: any) => p['aria-label'] === '收入统计维度').props.value[0], 'appId');
});
