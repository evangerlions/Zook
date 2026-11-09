# -*- coding: utf-8 -*-
"""Synthetic cash-only finance golden and browser recovery boundaries; never private profiles."""
import argparse,json,time,uuid,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--expected-grow-revision',required=True);p.add_argument('--output',required=True,type=Path);p.add_argument('--account',default='course3@example.com');p.add_argument('--other-account',default='course8@example.com');a=p.parse_args();assert a.url.startswith('http://127.0.0.1:') and all(re.fullmatch(r'course\d+@example.com',x) for x in [a.account,a.other_account]);a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True);c=b.new_context(viewport={'width':1440,'height':1000});page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];server_errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:server_errors.append({'url':r.url,'status':r.status}) if r.status>=500 and '/api/' in r.url else None);api=pw.request.new_context(base_url=a.url)
 def auth(account):return api.post('/api/v1/auth/login',data={'appId':'lighttick','account':account,'password':'Password1234','clientType':'app'}).json()['data']['accessToken']
 h={'Authorization':'Bearer '+auth(a.account),'X-App-Id':'lighttick'};other={'Authorization':'Bearer '+auth(a.other_account),'X-App-Id':'lighttick'}
 def req(path,body=None,method='GET',key=None,headers=None):
  r=api.fetch('/api/v1/lighttick/'+path,method=method,data=body,headers={**(headers or h),'Idempotency-Key':key or str(uuid.uuid4())});assert r.status==200,r.text();return r.json()['data']
 def wait(root,wid,status='succeeded'):
  end=time.monotonic()+30
  while time.monotonic()<end:
   w=req(root+'/portfolio/work/'+wid)
   if w['status'] not in ['queued','running']:assert w['status']==status,w;return w
   time.sleep(.1)
  raise AssertionError('No terminal worker result')
 def fill(label,value,scope):x=scope.get_by_label(label,exact=True);x.fill(value);expect(x).to_have_value(value)
 def login(account):
  fill('邮箱或手机号',account,page);fill('密码','Password1234',page);page.get_by_role('button',name='登录并继续',exact=True).click();page.get_by_role('link',name='投资资料',exact=True).click()
 def open_account(name):page.get_by_role('button',name=name+' · 使用中',exact=True).click();page.get_by_text('估值、绩效与账实核对',exact=True).click();expect(workspace()).to_be_visible()
 def workspace():return page.get_by_role('region',name='估值绩效与账实核对',exact=True)
 def editor(kind):return workspace().get_by_role('region',name=kind+'编辑',exact=True)
 def compare(kind):
  e=editor(kind);button=e.get_by_role('button',name='保留输入，准备新预览或报告',exact=True)
  if button.count():button.click()
  e.get_by_role('button',name='核对账户云端副本',exact=True).click();adopt=e.get_by_role('button',name='已比较，保留输入并采用账户基线',exact=True)
  expect(adopt).to_be_visible()
  # Restored immutable work may finish loading after mode navigation. Explicitly release
  # that terminal work before choosing a new account baseline; never mutate a frozen task.
  if adopt.is_disabled():
   prepare=e.get_by_role('button',name='保留输入，准备新预览或报告',exact=True)
   if prepare.count():expect(prepare).to_be_enabled();prepare.click()
  expect(adopt).to_be_enabled();adopt.click()
 token=uuid.uuid4().hex[:7];aid='inv-'+str(uuid.uuid4());root='investments/accounts/'+aid;name='Synthetic portfolio boundary '+token;oid='inv-'+str(uuid.uuid4());oname='Synthetic other owner '+token;pending=[]
 try:
  req(root,{'base_revision':0,'name':name,'currency':'CNY','baseline_date':'2026-10-26','opening_cash':'1000','opening_positions':[]},'PUT');req('investments/accounts/'+oid,{'base_revision':0,'name':oname,'currency':'CNY','baseline_date':'2026-10-26','opening_cash':'0','opening_positions':[]},'PUT',headers=other)
  for date,kind,value in [('2026-10-27','fee','100'),('2026-10-28','dividend','50')]:
   ac=req(root);w=req(root+'/events',{'base_revision':ac['revision'],'business_date':date,'kind':'cash','cash':{'kind':kind,'amount':value}},'POST');end=time.monotonic()+20
   while time.monotonic()<end:
    w=req('investments/work/'+w['id'])
    if w['status'] not in ['queued','running']:assert w['status']=='succeeded';break
    time.sleep(.1)
  for date in ['2026-10-26','2026-10-27','2026-10-28','2026-10-26','2026-10-27','2026-10-28']:
   w=req(root+'/portfolio/work',{'kind':'valuation','base_revision':3,'date':date,'sources':{}},'POST');w=wait(root,w['id']);req(root+'/portfolio/work/'+w['id']+'/adopt',{'base_revision':3,'preview_digest':w['output']['preview_digest']},'POST')
  page.goto(a.url+'/grow/investments');login(a.account);open_account(name);assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text();workspace().get_by_role('button',name='区间绩效',exact=True).click();fill('绩效开始日期','2026-10-26',editor('区间绩效'));fill('绩效结束日期','2026-10-28',editor('区间绩效'))
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/portfolio/work')) as created:editor('区间绩效').get_by_role('button',name='生成区间绩效报告',exact=True).click()
  assert created.value.status==200;perf=wait(root,created.value.json()['data']['id']);assert perf['output']['calendar']['sessions']['2026-10-27'] is True;assert perf['output']['algorithm_version']=='audited-economic-date-decimal60-calendar-v2';assert perf['output']['net_profit']=='-50' and perf['output']['maximum_drawdown_pct']=='10';expect(editor('区间绩效').get_by_role('region',name='区间绩效报告',exact=True)).to_contain_text('-50',timeout=15000)
  workspace().get_by_role('button',name='期初修正',exact=True).click();fill('期初修正原因','Local baseline draft survives read rebuild and account switch',editor('期初修正'));fill('修正期初现金','888.0000000000',editor('期初修正'));assert workspace().get_by_role('button',name='更多估值快照',exact=True).count()==1
  w=req(root+'/events',{'base_revision':3,'business_date':'2026-10-29','kind':'cash','cash':{'kind':'deposit','amount':'1'}},'POST');end=time.monotonic()+20
  while time.monotonic()<end:
   w=req('investments/work/'+w['id'])
   if w['status'] not in ['queued','running']:assert w['status']=='succeeded';break
   time.sleep(.1)
  workspace().get_by_role('button',name='更多估值快照',exact=True).click();expect(workspace().get_by_role('alert').filter(has_text='cursor expired')).to_be_visible();expect(editor('期初修正').get_by_label('修正期初现金',exact=True)).to_have_value('888.0000000000');workspace().get_by_role('button',name='重建估值绩效读取',exact=True).click();workspace().get_by_role('button',name='更多估值快照',exact=True).click();expect(workspace().get_by_role('region',name='已保存估值历史',exact=True).get_by_role('button',name=re.compile('查看估值 '))).to_have_count(6)
  workspace().get_by_role('button',name='估值预览',exact=True).click();compare('估值预览');fill('估值日期','2026-10-28',editor('估值预览'));c.set_offline(True)
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/portfolio/work')) as offline:editor('估值预览').get_by_role('button',name='生成估值预览',exact=True).click()
  expect(editor('估值预览').get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();before=(offline.value.post_data,offline.value.headers['idempotency-key']);c.set_offline(False);page.reload();open_account(name)
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/portfolio/work')) as retry:editor('估值预览').get_by_role('button',name='重试原请求',exact=True).click()
  assert (retry.value.post_data,retry.value.headers['idempotency-key'])==before;expect(editor('估值预览').get_by_role('region',name='估值预览结果',exact=True)).to_contain_text('950',timeout=20000)
  compare('估值预览')
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/portfolio/work')) as created:editor('估值预览').get_by_role('button',name='生成估值预览',exact=True).click()
  wid=created.value.json()['data']['id'];end=time.monotonic()+10
  while time.monotonic()<end:
   live=req(root+'/portfolio/work/'+wid)
   if live['status']=='running':break
   time.sleep(.05)
  assert live['status']=='running';receipt=editor('估值预览').get_by_label('估值绩效任务回执',exact=True);receipt.get_by_role('button',name='刷新估值绩效回执',exact=True).click();expect(receipt).to_contain_text('修订 '+str(live['revision']));use=receipt.get_by_role('button',name='核对并使用当前任务修订',exact=True)
  if use.count():use.click()
  receipt.get_by_role('button',name='取消估值绩效任务',exact=True).click();wait(root,wid,'cancelled');expect(receipt).to_contain_text('cancelled',timeout=10000);assert len(req(root+'/valuations')['items'])==6
  workspace().get_by_role('button',name='区间绩效',exact=True).click();compare('区间绩效')
  def budget(route):route.fulfill(status=429,content_type='application/json',body=json.dumps({'code':'VALIDATION_ERROR','message':'Synthetic portfolio work budget exhausted','requestId':'synthetic-budget'}))
  page.route('**/'+root+'/portfolio/work',budget);editor('区间绩效').get_by_role('button',name='生成区间绩效报告',exact=True).click();expect(editor('区间绩效').get_by_text(re.compile('本次提交被拒绝'))).to_be_visible();expect(editor('区间绩效').get_by_label('绩效开始日期',exact=True)).to_have_value('2026-10-26');page.unroute('**/'+root+'/portfolio/work',budget);editor('区间绩效').get_by_role('button',name='已核对，解除待核对状态',exact=True).click()
  def lost(route):
   r=route.fetch();assert r.status==200,r.text();pending.append({'body':route.request.post_data,'key':route.request.headers['idempotency-key'],'work_id':r.json()['data']['id']});route.abort('failed')
  page.route('**/'+root+'/portfolio/work',lost);editor('区间绩效').get_by_role('button',name='生成区间绩效报告',exact=True).click();expect(editor('区间绩效').get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/'+root+'/portfolio/work',lost);assert len(pending)==1
  replayed_while_other=[];page.get_by_role('button',name='退出登录',exact=True).click();expect(page.get_by_label('邮箱或手机号')).to_be_visible();login(a.other_account);page.on('request',lambda r:replayed_while_other.append(r.url) if r.method=='POST' and r.headers.get('idempotency-key')==pending[0]['key'] else None);open_account(oname);workspace().get_by_role('button',name='期初修正',exact=True).click();expect(editor('期初修正').get_by_label('期初修正原因',exact=True)).to_have_value('');assert api.get('/api/v1/lighttick/'+root+'/portfolio/work/'+pending[0]['work_id'],headers=other).status==404;assert api.get('/api/v1/lighttick/investments/accounts/'+oid+'/portfolio/work',headers=h).status==404;assert replayed_while_other==[]
  page.get_by_role('button',name='退出登录',exact=True).click();expect(page.get_by_label('邮箱或手机号')).to_be_visible();login(a.account);open_account(name);workspace().get_by_role('button',name='期初修正',exact=True).click();expect(editor('期初修正').get_by_label('期初修正原因',exact=True)).to_have_value('Local baseline draft survives read rebuild and account switch');expect(editor('期初修正').get_by_label('修正期初现金',exact=True)).to_have_value('888.0000000000');workspace().get_by_role('button',name='区间绩效',exact=True).click()
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/portfolio/work')) as replay:editor('区间绩效').get_by_role('button',name='重试原请求',exact=True).click()
  assert (replay.value.post_data,replay.value.headers['idempotency-key'])==(pending[0]['body'],pending[0]['key']);wait(root,pending[0]['work_id']);expect(editor('区间绩效').get_by_role('region',name='区间绩效报告',exact=True)).to_contain_text('-50',timeout=15000);editor('区间绩效').get_by_role('region',name='区间绩效报告',exact=True).evaluate("e=>e.scrollIntoView({block:'start'})");page.screenshot(path=str(a.output/'performance-and-recovery.png'));assert errors==[] and server_errors==[],(errors,server_errors)
  result={'passed':True,'served_revision':a.expected_grow_revision,'account':a.account,'account_id':aid,'other_account_id':oid,'cash_equity_series':['1000','900','950'],'net_profit':'-50','maximum_drawdown_pct':'10','expired_cursor_rebuild_keeps_draft':True,'offline_retries_exact_original_body_and_key':True,'actual_cancel_fences_worker_without_adoption':True,'injected_429_retains_draft_and_original':True,'account_switch_keeps_pending_request_and_draft_scoped':True,'other_owner_404':True,'no_replay_while_other_owner':True,'page_errors':errors,'http_5xx':server_errors,'chrome_version':b.version}
 except Exception:
  page.screenshot(path=str(a.output/'failure.png'));(a.output/'failure-context.json').write_text(json.dumps({'account_id':aid,'account_name':name,'visible':page.locator('body').inner_text()[-10000:],'page_errors':errors},ensure_ascii=False,indent=2));raise
 finally:page.close(run_before_unload=False);api.dispose();b.close()
 result['browser_cleanup_completed']=True;(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print('GSTACK_STEP_OK',flush=True)
