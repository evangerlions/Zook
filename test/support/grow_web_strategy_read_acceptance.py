# -*- coding: utf-8 -*-
"""Read-only report/console verification after synthetic sign-in; creates no backtest work."""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser()
for flag in ['url','expected-grow-revision']:p.add_argument('--'+flag,required=True)
for flag in ['output','main-result']:p.add_argument('--'+flag,type=Path,required=True)
a=p.parse_args();assert a.url.startswith('http://127.0.0.1:');main=json.loads(a.main_result.read_text());assert main['passed'];a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True);context=b.new_context(viewport={'width':1440,'height':1000});page=context.new_page();console=[];errors=[];responses=[]
 page.on('console',lambda m:console.append({'text':m.text,'url':m.location.get('url','')}) if m.type=='error' else None);page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:responses.append({'url':r.url,'status':r.status}) if r.status>=400 else None)
 try:
  page.goto(a.url+'/grow/investments');page.get_by_label('邮箱或手机号').fill('course9@example.com');page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();expect(page.get_by_role('button',name='退出登录',exact=True)).to_be_visible();bootstrap={'console':list(console),'responses':list(responses)};console.clear();responses.clear();page.goto(a.url+'/grow/investments');panel=page.get_by_role('region',name='策略与回测',exact=True);run=panel.get_by_role('region',name='策略执行与持久报告',exact=True);run.get_by_role('button',name='回测 '+main['grid_id']+' · grid · succeeded',exact=True).click();report=run.get_by_role('region',name='持久回测报告',exact=True);expect(report).to_contain_text('报告：资料齐备的受控模拟');report.get_by_label('回测结果明细',exact=True).select_option('prices');report.get_by_role('button',name='读取回测明细',exact=True).click();expect(report.get_by_role('region',name='回测组合明细',exact=True)).to_contain_text('已读取 4 / 4 条')
  for width in [320,375,768,1024]:
   page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
   table=report.get_by_role('region',name='回测比较表',exact=True);table.evaluate('(e)=>{e.scrollLeft=e.scrollWidth;return true;}');assert table.evaluate('e=>e.scrollWidth>=e.clientWidth');expect(table.get_by_role('button',name='查看组合 4',exact=True)).to_be_attached()
  page.set_viewport_size({'width':375,'height':900});report.get_by_role('heading',name='回测任务 · succeeded',exact=True).scroll_into_view_if_needed();page.screenshot(path=str(a.output/'report-375.png'));assert errors==[],errors;assert console==[],console;assert responses==[],responses
  result={'passed':True,'served_revision':a.expected_grow_revision,'chrome_version':b.version,'readonly_existing_grid_report':True,'mobile_table_scroll_is_local_and_data_remains_accessible':True,'bootstrap_before_login':bootstrap,'authenticated_console_errors':console,'authenticated_http_errors':responses,'page_errors':errors}
 except Exception:page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:page.close(run_before_unload=False);b.close()
 result['browser_cleanup_completed']=True;(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print('CONSOLE_ERRORS=[]\nGSTACK_STEP_OK',flush=True)
