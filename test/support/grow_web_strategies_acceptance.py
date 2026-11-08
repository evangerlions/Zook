# -*- coding: utf-8 -*-
"""Dedicated localhost Chrome acceptance, synthetic CSV and explicitly declared facts only."""
import argparse, json, time, uuid, re, hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

p=argparse.ArgumentParser()
for flag in ['url','expected-grow-revision']:p.add_argument('--'+flag,required=True)
for flag in ['output','fixture']:p.add_argument('--'+flag,type=Path,required=True)
a=p.parse_args();assert a.url.startswith('http://127.0.0.1:');seed=json.loads(a.fixture.read_text());assert seed['synthetic'] and seed['owner']=='user_course_9';a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True);c=b.new_context(viewport={'width':1440,'height':1000});page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)));api=pw.request.new_context(base_url=a.url)
 assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text()
 auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':'course9@example.com','password':'Password1234','clientType':'app'}).json()['data'];headers={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'};root='/api/v1/lighttick/investments/'
 def req(path,body=None,method='GET'):
  r=api.fetch(root+path,headers={**headers,'Idempotency-Key':str(uuid.uuid4())},method=method,data=body);assert r.status==200,r.text();return r.json()['data']
 def panel():return page.get_by_role('region',name='策略与回测',exact=True)
 def editor():return panel().get_by_role('region',name='策略编辑',exact=True)
 def run():return panel().get_by_role('region',name='策略执行与持久报告',exact=True)
 def report():return run().get_by_role('region',name='持久回测报告',exact=True)
 def login(account):
  page.get_by_label('邮箱或手机号').fill(account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();expect(page.get_by_role('button',name='退出登录',exact=True)).to_be_visible();page.goto(a.url+'/grow/investments')
 def adopt(sid,version):
  r=run().get_by_role('region',name='回测参数版本与组合',exact=True);r.get_by_label('回测选择策略',exact=True).select_option(sid);r.get_by_label('回测策略版本',exact=True).fill(str(version));r.get_by_role('button',name='核对回测策略版本',exact=True).click();expect(r.get_by_label('待采用策略版本',exact=True)).to_contain_text('· v'+str(version));r.get_by_role('button',name='采用此策略版本供回测',exact=True).click()
 def terminal(wid):
  end=time.monotonic()+25
  while time.monotonic()<end:
   w=req('backtests/'+wid)
   if w['status'] not in ['queued','running']:return w
   time.sleep(.15)
  raise AssertionError('Worker terminal timeout')
 def submit():
  run().get_by_label('我已核对策略版本、数据、日期和执行条件，明确提交本次计算',exact=True).check()
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/investments/backtests')) as created:run().get_by_role('button',name='提交回测计算',exact=True).click()
  assert created.value.status==200,created.value.text();return created.value.json()['data']['id']
 try:
  page.goto(a.url+'/grow/investments');login('course9@example.com');panel().get_by_role('button',name='准备新策略',exact=True).click();e=editor();label='Synthetic strategy '+uuid.uuid4().hex[:6];original='  Original strategy hypothesis\nPreserve unchanged  ';e.get_by_label('策略名称',exact=True).fill(label);e.get_by_label('策略说明与反证',exact=True).fill(original);e.get_by_label('受控策略',exact=True).select_option('threshold')
  for field,value in [('入场收盘阈值（元）','10'),('离场收盘阈值（元）','9'),('佣金率（小数）','0'),('最低佣金（元）','0'),('卖出税率（小数）','0'),('滑点（基点）','0'),('成交量最大参与率（小数）','1')]:e.get_by_label('策略'+field,exact=True).fill(value)
  lost=[]
  def lose(route):
   if route.request.method=='PUT':
    r=route.fetch();assert r.status==200,r.text();lost.append((route.request.post_data,route.request.headers['idempotency-key'],r.json()['data']));route.abort('failed')
   else:route.continue_()
  page.route('**/investments/strategies/inv-*',lose);e.get_by_role('button',name='保存策略版本',exact=True).click();expect(e.get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/investments/strategies/inv-*',lose);sid=lost[0][2]['id'];page.reload();panel().get_by_role('button',name='准备新策略',exact=True).click();expect(editor().get_by_label('策略说明与反证',exact=True)).to_have_value(original)
  with page.expect_request(lambda r:r.method=='PUT' and r.url.endswith('/strategies/'+sid)) as replay:editor().get_by_role('button',name='重试原请求',exact=True).click()
  r=replay.value;assert (r.post_data,r.headers['idempotency-key'])==lost[0][:2];expect(panel().get_by_role('button',name=label+' · 策略 v1 · '+sid,exact=True)).to_be_visible();expect(editor()).to_have_count(1)
  cloud=req('strategies/'+sid);req('strategies/'+sid,{'base_revision':1,'fields':{**cloud['fields'],'description':'Cloud strategy reflection','config':{**cloud['fields']['config'],'entry_above':'12'}}},'PUT');editor().get_by_label('策略说明与反证',exact=True).fill('Local compared reflection');editor().get_by_role('button',name='保存策略版本',exact=True).click();expect(editor().get_by_role('button',name='已核对，解除待核对状态',exact=True)).to_be_visible();editor().get_by_role('button',name='核对云端策略',exact=True).click();conflict=editor().get_by_role('region',name='策略冲突核对',exact=True);expect(conflict.get_by_text('Cloud strategy reflection',exact=True)).to_be_visible();conflict.get_by_text('保存时的策略基线',exact=True).click();expect(conflict.get_by_text(original,exact=True)).to_be_visible();editor().get_by_role('button',name='已核对，解除待核对状态',exact=True).click();conflict.get_by_role('button',name='已比较，保留本机策略并采用云端基线',exact=True).click();editor().get_by_role('button',name='保存策略版本',exact=True).click();expect(panel().get_by_role('button',name=label+' · 策略 v3 · '+sid,exact=True)).to_be_visible();assert req('strategies/'+sid+'/versions/1')['fields']['description']==original;expect(editor()).to_have_count(1)
  adopt(sid,1);sources=run().get_by_role('region',name='回测来源与执行条件',exact=True);sources.get_by_label('回测标的',exact=True).select_option(seed['instrument']['id']);picker=sources.get_by_role('region',name='核对日线来源',exact=True);picker.get_by_role('button',name='读取可选日线快照',exact=True).click();expect(picker.get_by_label('选择精确日线快照',exact=True).get_by_role('option').filter(has_text=seed['source_id'])).to_be_attached();picker.get_by_label('选择精确日线快照',exact=True).select_option(seed['source_id']);sources.get_by_role('button',name='核对回测日线来源',exact=True).click();preview=sources.get_by_label('回测快照核对',exact=True);expect(preview).to_contain_text('4条日线');preview.get_by_role('button',name='采用快照范围与摘要',exact=True).click();preview.get_by_role('button',name='准备逐日执行条件',exact=True).click();expect(sources.get_by_label('2026-11-03 交易状态',exact=True)).to_have_value('unknown');sources.get_by_label('回测执行条件依据',exact=True).fill('Synthetic reviewed daily conditions only');sources.get_by_label('2026-11-03 可获知时点',exact=True).fill('2026-11-03T15:05:00+08:00');sources.get_by_label('2026-11-03 交易状态',exact=True).select_option('normal')
  for field,value in [('涨停价（元）','20'),('跌停价（元）','5'),('信号复权因子','1'),('当日份额变动倍数','1'),('每股现金分红（元）','0')]:sources.get_by_label('2026-11-03 '+field,exact=True).fill(value)
  sources.get_by_role('button',name='将首日已核对条件应用到全部交易日',exact=True).click();expect(sources.get_by_label('2026-11-06 涨停价（元）',exact=True)).to_have_value('20');sources.get_by_role('button',name='使用当前执行条件核对时点',exact=True).click();sources.get_by_role('button',name='使用当前回测决策时点',exact=True).click();run().get_by_label('我已核对策略版本、数据、日期和执行条件，明确提交本次计算',exact=True).check();lost_run=[]
  def lose_run(route):
   if route.request.method=='POST':
    r=route.fetch();assert r.status==200,r.text();lost_run.append((route.request.post_data,route.request.headers['idempotency-key'],r.json()['data']));route.abort('failed')
   else:route.continue_()
  page.route('**/investments/backtests',lose_run);run().get_by_role('button',name='提交回测计算',exact=True).click();expect(run().get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/investments/backtests',lose_run);wid=lost_run[0][2]['id'];page.reload()
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/investments/backtests')) as replay:run().get_by_role('button',name='重试原请求',exact=True).click()
  r=replay.value;assert (r.post_data,r.headers['idempotency-key'])==lost_run[0][:2];done=terminal(wid);assert done['status']=='succeeded' and done['output']['status']=='complete',done;assert done['output']['cases'][0]['result']['metrics']['net_profit']=='200';assert done['input']['strategies'][0]['revision']==1;expect(report().get_by_text('回测任务 · succeeded',exact=True)).to_be_visible(timeout=20000);report().get_by_role('button',name='读取回测明细',exact=True).click();expect(report().get_by_role('region',name='回测组合明细',exact=True)).to_contain_text('已读取 4 / 4 条');report().screenshot(path=str(a.output/'single-report.png'))
  run().get_by_label('回测计算方式',exact=True).select_option('compare');adopt(sid,1);adopt(sid,2);compare_id=submit();compared=terminal(compare_id);assert [r['result']['metrics']['net_profit'] for r in compared['output']['cases']]==['200','0'];expect(report().get_by_role('region',name='回测比较表',exact=True).get_by_role('button',name='查看组合 2',exact=True)).to_be_visible(timeout=20000)
  run().get_by_label('回测计算方式',exact=True).select_option('grid');adopt(sid,1)
  for i,values in [(1,'10,12'),(2,'8,9')]:run().get_by_role('button',name='添加网格参数轴',exact=True).click();run().get_by_label('网格轴 '+str(i)+' 候选值',exact=True).fill(values)
  grid_id=submit();grid=terminal(grid_id);assert grid['status']=='succeeded' and len(grid['output']['cases'])==4;assert [r['result']['metrics']['net_profit'] for r in grid['output']['cases']]==['200','200','0','0'];expect(report().get_by_role('region',name='回测比较表',exact=True).get_by_role('button',name='查看组合 4',exact=True)).to_be_visible(timeout=20000);report().get_by_role('button',name='查看组合 4',exact=True).click();report().get_by_label('回测结果明细',exact=True).select_option('execution');report().get_by_role('button',name='读取回测明细',exact=True).click();expect(report().get_by_role('region',name='回测组合明细',exact=True)).to_contain_text('已读取 4 / 4 条');report().screenshot(path=str(a.output/'grid-report.png'))
  cancel_id=submit();expect(report().get_by_text('回测任务 · running',exact=True)).to_be_visible(timeout=10000);cancel=run().get_by_role('region',name='回测执行取消',exact=True);adopt_cancel=cancel.get_by_role('button',name='核对并采用回测任务修订',exact=True)
  if adopt_cancel.is_visible():adopt_cancel.click()
  cancel.get_by_role('button',name='取消回测执行',exact=True).click();expect(report().get_by_text('回测任务 · cancelled',exact=True)).to_be_visible();time.sleep(4.2);assert req('backtests/'+cancel_id)['output'] is None
  panel().get_by_role('button',name=label+' · 策略 v3 · '+sid,exact=True).click();editor().get_by_role('button',name='归档策略',exact=True).click();expect(editor().get_by_role('button',name='恢复策略',exact=True)).to_be_visible();editor().get_by_role('button',name='恢复策略',exact=True).click();expect(panel().get_by_role('button',name=label+' · 策略 v5 · '+sid,exact=True)).to_be_visible();assert req('backtests/'+grid_id)['output']['output_digest']==grid['output']['output_digest']
  offline='Retained offline strategy draft';editor().get_by_label('策略说明与反证',exact=True).fill(offline);editor().get_by_role('button',name='查看策略历史',exact=True).click();expect(editor().get_by_role('region',name='策略历史',exact=True)).to_be_visible();c.set_offline(True);page.evaluate("window.dispatchEvent(new Event('offline'))");expect(editor().get_by_role('region',name='策略历史',exact=True)).not_to_be_visible();expect(editor().get_by_label('策略说明与反证',exact=True)).to_have_value(offline);c.set_offline(False);page.evaluate("window.dispatchEvent(new Event('online'))");page.reload();panel().get_by_role('button',name=label+' · 策略 v5 · '+sid,exact=True).click();expect(editor().get_by_label('策略说明与反证',exact=True)).to_have_value(offline);pending=[]
  def fail_before(route):
   if route.request.method=='PUT':pending.append((route.request.post_data,route.request.headers['idempotency-key']));route.abort('failed')
   else:route.continue_()
  page.route('**/investments/strategies/'+sid,fail_before);editor().get_by_role('button',name='保存策略版本',exact=True).click();expect(editor().get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/investments/strategies/'+sid,fail_before);page.get_by_role('button',name='退出登录',exact=True).click();login('course8@example.com');panel().get_by_role('button',name='准备新策略',exact=True).click();expect(editor().get_by_label('策略说明与反证',exact=True)).to_have_value('');expect(editor().get_by_role('button',name='重试原请求',exact=True)).not_to_be_visible();page.reload();page.get_by_role('button',name='退出登录',exact=True).click();login('course9@example.com');panel().get_by_role('button',name=label+' · 策略 v5 · '+sid,exact=True).click()
  with page.expect_request(lambda r:r.method=='PUT' and r.url.endswith('/strategies/'+sid)) as replay:editor().get_by_role('button',name='重试原请求',exact=True).click()
  r=replay.value;assert (r.post_data,r.headers['idempotency-key'])==pending[0];expect(panel().get_by_role('button',name=label+' · 策略 v6 · '+sid,exact=True)).to_be_visible();assert req('strategies/'+sid)['fields']['description']==offline
  doc=api.get('/api/v1/lighttick/review/export',headers=headers).json()['data'];assert hashlib.sha256(doc['content'].encode()).hexdigest()==doc['sha256'];export=json.loads(doc['content'])['investments']['strategies'];assert len([v for v in export['versions'] if v['id']==sid])==6;raw=next(w for w in export['runs'] if w['id']==grid_id);assert len(raw['input']['snapshot']['dataset']['bars'])==4 and len(raw['input']['execution_review']['facts'])==4;assert next(w for w in export['runs'] if w['id']==cancel_id)['commands'][-1]['action']=='cancel';assert 'lease_until' not in json.dumps(export) and '"fence"' not in json.dumps(export);assert req('accounts')['items']==[]
  for width in [320,375,768,1024]:page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
  page.set_viewport_size({'width':320,'height':900});editor().get_by_label('策略说明与反证',exact=True).scroll_into_view_if_needed();page.screenshot(path=str(a.output/'strategy-320.png'));assert errors==[],errors
  result={'passed':True,'served_revision':a.expected_grow_revision,'strategy_id':sid,'strategy_label':label,'single_id':wid,'compare_id':compare_id,'grid_id':grid_id,'cancel_id':cancel_id,'source_version_and_original_request_after_reload':True,'three_way_CAS_original_text_and_historical_params':True,'actual_worker_thread_single_compare_grid_complete':True,'known_net_profits':['200','0'],'grid_net_profits':['200','200','0','0'],'frozen_execution_fact_pagination':True,'running_cancel_no_late_report':True,'archive_restore_preserves_old_reports':True,'offline_and_owner_switch_exact_pending_recovery':True,'export_full_inputs_reports_originals_without_secrets':True,'no_asset_account':True,'widths':[320,375,768,1024],'page_errors':errors}
 except Exception:page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:
  # Browser.close owns every context; avoid a separate context-close wait after routed polling.
  page.close(run_before_unload=False);api.dispose();b.close()
 result['browser_cleanup_completed']=True;(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print('GSTACK_STEP_OK',flush=True)
