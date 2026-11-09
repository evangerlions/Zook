# -*- coding: utf-8 -*-
"""Synthetic localhost capability reads; transport fault fixtures never change provider settings."""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
p=argparse.ArgumentParser()
p.add_argument('--url',required=True);p.add_argument('--expected-grow-revision',required=True);p.add_argument('--output',required=True,type=Path)
a=p.parse_args();assert a.url.startswith('http://127.0.0.1:');a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True);c=b.new_context(viewport={'width':1440,'height':1000});page=c.new_page();errors=[];calls=[];http_errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:calls.append({'method':r.method,'path':r.url.split(a.url)[-1]}) if '/api/v1/' in r.url else None)
 page.on('response',lambda r:http_errors.append({'path':r.url.split(a.url)[-1],'status':r.status}) if r.status>=400 else None)
 path='**/api/v1/lighttick/investments/market/capabilities'
 def login(actor):
  page.get_by_label('邮箱或手机号').fill(actor);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续',exact=True).click();expect(page.get_by_role('button',name='退出登录',exact=True)).to_be_visible()
 def settings():return page.get_by_role('region',name='数据源能力',exact=True)
 def refresh():settings().get_by_role('button',name='刷新数据源状态',exact=True).click()
 try:
  page.goto(a.url+'/grow/investments');login('course9@example.com');page.goto(a.url+'/grow/investments')
  assert a.expected_grow_revision in page.request.get(a.url+'/grow/runtime-config.js').text()
  page.get_by_role('button',name='数据源配置',exact=True).click();s=settings();items=s.get_by_role('list',name='服务端数据源状态',exact=True)
  expect(items).to_contain_text('CSV 导入：可提交日线任务');expect(items).to_contain_text('东方财富：可提交日线任务');expect(items).to_contain_text('Tushare：已关闭');expect(items).to_contain_text('腾讯：已关闭')
  expect(s.get_by_text('此状态不代表供应商实时连接测试通过。',exact=False)).to_be_visible();expect(s.get_by_role('textbox')).to_have_count(0);expect(s.get_by_role('button',name='测试连接')).to_have_count(0)
  expect(s.get_by_role('region',name='其他数据源范围')).to_contain_text('尚未接入');expect(s.get_by_role('region',name='Tushare 凭据说明')).to_contain_text('个人 Tushare 凭据配置尚待实现')
  s.screenshot(path=str(a.output/'capabilities.png'))
  def unavailable(route):route.fulfill(status=503,json={'code':'SYNTHETIC_UNAVAILABLE','message':'Synthetic capabilities unavailable','requestId':'synthetic-source-error'})
  page.route(path,unavailable);refresh();expect(s.get_by_role('alert')).to_contain_text('状态尚未确认');expect(items).to_have_count(0);page.unroute(path,unavailable);refresh();expect(items).to_be_visible()
  def missing(route):
   response=route.fetch();assert response.status==200;body=response.json()
   for row in body['data']['suppliers']:
    if row['supplier']=='tushare':row['enabled']=True;row['credential_configured']=False
   route.fulfill(response=response,json=body)
  page.route(path,missing);refresh();expect(items).to_contain_text('Tushare：服务端凭据未配置');page.unroute(path,missing)
  def malformed(route):route.fulfill(status=200,json={'code':'OK','message':'ok','requestId':'synthetic-schema-error','data':{'suppliers':[{'supplier':'akshare','enabled':True}]}})
  page.route(path,malformed);refresh();expect(s.get_by_role('alert')).to_contain_text('响应无效');expect(items).to_have_count(0);page.unroute(path,malformed);refresh();expect(items).to_contain_text('Tushare：已关闭')
  c.set_offline(True);refresh();expect(s.get_by_role('alert')).to_contain_text('状态尚未确认');expect(items).to_have_count(0);c.set_offline(False);refresh();expect(items).to_be_visible()
  for width in [320,375,768,1024]:
   page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
  page.set_viewport_size({'width':375,'height':900});s.scroll_into_view_if_needed();page.screenshot(path=str(a.output/'capabilities-375.png'))
  page.get_by_role('button',name='退出登录',exact=True).click();login('course8@example.com');page.goto(a.url+'/grow/investments');page.get_by_role('button',name='数据源配置',exact=True).click();expect(settings().get_by_role('list',name='服务端数据源状态',exact=True)).to_contain_text('Tushare：已关闭');expect(settings().get_by_role('alert')).to_have_count(0)
  forbidden=[r for r in calls if 'data-source-configs' in r['path'] or 'data-sources' in r['path'] or '/admin/' in r['path']]
  assert forbidden==[],forbidden;assert errors==[],errors
  result={'passed':True,'served_revision':a.expected_grow_revision,'chrome_version':b.version,'actual_server_states':{'csv':'available','eastmoney':'available','tushare':'disabled','tencent':'disabled'},'transport_fault_cases':['503','enabled_without_credential','invalid_schema','offline'],'fault_cases_do_not_change_server_config':True,'errors_clear_readiness_and_retry_recovers':True,'account_switch_does_not_restore_prior_state':True,'no_token_fields_or_legacy_admin_calls':True,'responsive_widths':[320,375,768,1024],'page_errors':errors,'http_errors_expected_bootstrap_or_injected':http_errors}
 except Exception:page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:page.close(run_before_unload=False);b.close()
 result['browser_cleanup_completed']=True;(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print('GSTACK_STEP_OK',flush=True)
