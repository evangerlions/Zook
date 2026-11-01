import * as billingTerms from "../../apps/admin-web/app/lib/billing-terms.ts";
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

test('overview dimension control changes the real query, columns and pagination identity', async () => {
  const ts = createRequire(new URL('../../apps/admin-web/package.json', import.meta.url))('typescript');
  const source = await readFile(new URL('../../apps/admin-web/app/components/billing-overview-section.tsx',import.meta.url),'utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const cells: any[]=[]; let index=0; let query: any; let queryIdentity='';
  const jsx=(type:any,props:any,key?:string)=>({type,props,key});
  const modules: Record<string,any>={
    "../lib/billing-terms": billingTerms,
    react:{useState:(initial:any)=>{const position=index++;if(!(position in cells))cells[position]=initial;return[cells[position],(value:any)=>{cells[position]=value;}];}},
    'react/jsx-runtime':{jsx,jsxs:jsx},
    antd:{Alert:'Alert',Button:'Button',Select:'Select',Space:'Space',Table:'Table',Tag:'Tag',DatePicker:{RangePicker:'RangePicker'}},
    '../lib/billing-admin-api':{billingAdminApi:{overview:(value:any)=>{query=value;}}},
    '../lib/billing-format':{formatBillingMoney:()=>''},
    '../lib/use-billing-query':{useBillingQuery:(load:any,key:string)=>{queryIdentity=key;load();return{loading:false,refresh:()=>{},data:{rows:[],from:'from',to:'to'}};}},
  };
  const exports:any={};runInNewContext(compiled,{exports,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
  const render=()=>{index=0;return exports.BillingOverviewSection({appId:'ai_novel',environment:'SANDBOX'});};
  const find=(node:any,type:string):any=>{
    if(Array.isArray(node))return node.map(child=>find(child,type)).find(Boolean);
    if(!node||typeof node!=='object')return undefined;
    return node.type===type?node:find(node.props?.children,type);
  };
  let tree=render();let table=find(tree,'Table');const initialKey=table.key;const initialQueryKey=queryIdentity;
  assert.equal(query.groupBy,'appId');assert.equal(query.appId,'ai_novel');assert.equal(query.environment,'SANDBOX');
  assert.deepEqual(Array.from(table.props.columns.map((column:any)=>column.title)),['日期（UTC）','应用','币种','付费交易数','购买金额','退款金额']);
  const select=find(tree,'Select');assert.equal(select.props.mode,'multiple');
  assert.equal(select.props['aria-label'],'收入统计维度');
  assert.ok(select.props.options.some((option:any)=>option.value==='source'&&option.label==='支付来源'));
  assert.ok(select.props.options.some((option:any)=>option.value==='market'&&option.label==='渠道（Market）'));
  select.props.onChange(['appId','productKey','source','market']);tree=render();table=find(tree,'Table');
  assert.equal(query.groupBy,'appId,productKey,source,market');assert.notEqual(queryIdentity,initialQueryKey);assert.notEqual(table.key,initialKey);
  assert.ok(table.props.columns.some((column:any)=>column.dataIndex==='productKey'));
  const sourceColumn=table.props.columns.find((column:any)=>column.dataIndex==='source');
  assert.equal(sourceColumn.title,billingTerms.BILLING_TERMS.source.label);
  assert.equal(sourceColumn.render('play_store'),'Google Play');
  const marketColumn=table.props.columns.find((column:any)=>column.dataIndex==='market');
  assert.equal(marketColumn.render('xiaomi'),'小米');
  assert.equal(marketColumn.render(null),'未知渠道');
  const row={date:'2026-10-23',appId:'ai_novel',source:'alipay',currency:'CNY',productKey:'plus_yearly'};
  assert.notEqual(table.props.rowKey(row),table.props.rowKey({...row,productKey:'pro_yearly'}));
  find(tree,'Select').props.onChange(['source']);tree=render();
  assert.equal(query.groupBy,'source');
  assert.ok(!find(tree,'Table').props.columns.some((column:any)=>column.dataIndex==='appId'));
  find(tree,'Select').props.onChange([]);render();assert.equal(query.groupBy,'appId');
});
