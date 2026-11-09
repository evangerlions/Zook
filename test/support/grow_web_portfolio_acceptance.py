# -*- coding: utf-8 -*-
"""Only synthetic localhost accounts, real Chrome/PG and the existing worker."""
import argparse,json,time,uuid,hashlib,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--expected-grow-revision',required=True);p.add_argument('--output',required=True,type=Path);p.add_argument('--account',default='course1@example.com');a=p.parse_args();assert a.url.startswith('http://127.0.0.1:') and re.fullmatch(r'course\d+@example.com',a.account);a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True);context=b.new_context(viewport={'width':1440,'height':1000});page=context.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)));api=pw.request.new_context(base_url=a.url)
 auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':a.account,'password':'Password1234','clientType':'app'}).json()['data'];headers={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'}
 def request(path,body=None,method='GET',key=None):
  r=api.fetch('/api/v1/lighttick/'+path,headers={**headers,'Idempotency-Key':key or str(uuid.uuid4())},method=method,data=body);assert r.status==200,r.text();return r.json()['data']
 def wait(path,wid):
  end=time.monotonic()+30
  while time.monotonic()<end:
   w=request(path+'/'+wid)
   if w['status'] not in ['queued','running']:assert w['status']=='succeeded',w;return w
   time.sleep(.1)
  raise AssertionError('Worker did not finish')
 def fill(label,value,scope=None):
  x=(scope or page).get_by_label(label,exact=True);x.fill(value);expect(x).to_have_value(value)
 def workspace():return page.get_by_role('region',name='估值绩效与账实核对',exact=True)
 def editor(kind='估值预览'):return workspace().get_by_role('region',name=kind+'编辑',exact=True)
 def open_account(name):
  page.get_by_role('button',name=name+' · 使用中',exact=True).click();page.get_by_text('估值、绩效与账实核对',exact=True).click();expect(workspace()).to_be_visible()
 def submit_work(root,kind='估值预览'):
  e=editor(kind);label={'估值预览':'生成估值预览','期初修正':'后台核对期初影响','区间绩效':'生成区间绩效报告'}[kind]
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/'+root+'/portfolio/work')) as pending:e.get_by_role('button',name=label,exact=True).click()
  assert pending.value.status==200,pending.value.text();wid=pending.value.json()['data']['id'];w=wait(root+'/portfolio/work',wid);assert w['output']['kind']=='baseline' or w['output']['algorithm_version']=='audited-economic-date-decimal60-calendar-v2';expect(e.get_by_label('估值绩效任务回执',exact=True)).to_contain_text('succeeded',timeout=15000);return w
 def adopt(root,kind='估值预览'):
  e=editor(kind);label='确认采用期初修正' if kind=='期初修正' else '确认保存估值快照'
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/adopt')) as pending:e.get_by_role('button',name=label,exact=True).click()
  assert pending.value.status==200,pending.value.text();expect(e.get_by_text(re.compile('已采用并保留记录'))).to_be_visible();return pending.value.json()['data']
 def prepare(date):
  e=editor();button=e.get_by_role('button',name='保留输入，准备新预览或报告',exact=True)
  if button.count():button.click()
  e.get_by_role('button',name='核对账户云端副本',exact=True).click();e.get_by_role('button',name='已比较，保留输入并采用账户基线',exact=True).click();fill('估值日期',date,e)
 def market(instrument,source='Synthetic audited CSV'):
  csv='date,open,high,low,close,volume,amount\n2026-10-26,10,10,10,10,100,1000\n2026-10-27,11,11,11,11,100,1100\n2026-10-28,9,9,9,9,100,900\n'
  w=request('investments/market/work',{'instrument_id':instrument,'base_revision':1,'supplier':'csv','start':'2026-10-26','end':'2026-10-28','csv':csv,'declared_source':source,'volume_unit':'shares','amount_unit':'CNY'},'POST');return wait('investments/market/work',w['id'])['snapshot_id']
 token=uuid.uuid4().hex[:7];name='Synthetic portfolio '+token;aid='inv-'+str(uuid.uuid4());root='investments/accounts/'+aid;original_lost=[]
 try:
  instrument=request('investments/instruments',{'code':'51'+str(int(token,16)%10000).zfill(4),'market':'SSE','kind':'etf','name':'Synthetic portfolio ETF '+token},'POST')['instrument'];iid=instrument['id']
  request(root,{'base_revision':0,'name':name,'currency':'CNY','baseline_date':'2026-10-26','opening_cash':'10000','opening_positions':[{'instrument_id':iid,'quantity':'100','cost':'900'}]},'PUT');source=market(iid)
  page.goto(a.url+'/grow/investments');fill('邮箱或手机号',a.account);fill('密码','Password1234');page.get_by_role('button',name='登录并继续',exact=True).click();open_account(name);assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text();fill('估值日期','2026-10-26',editor())
  def lose(route):
   response=route.fetch();assert response.status==200,response.text();original_lost.append({'path':route.request.url,'body':route.request.post_data,'key':route.request.headers['idempotency-key'],'data':response.json()['data']});route.abort('failed')
  page.route('**/'+root+'/portfolio/work',lose);editor().get_by_role('button',name='生成估值预览',exact=True).click();expect(editor().get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/'+root+'/portfolio/work',lose);wait(root+'/portfolio/work',original_lost[0]['data']['id']);page.reload();open_account(name)
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/portfolio/work')) as replay:editor().get_by_role('button',name='重试原请求',exact=True).click()
  assert replay.value.post_data==original_lost[0]['body'] and replay.value.headers['idempotency-key']==original_lost[0]['key'];expect(editor().get_by_role('region',name='估值预览结果',exact=True)).to_contain_text('11000',timeout=15000);assert request(root+'/valuations')['items']==[]
  page.route('**/'+root+'/portfolio/work/*/adopt',lose);editor().get_by_role('button',name='确认保存估值快照',exact=True).click();expect(editor().get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/'+root+'/portfolio/work/*/adopt',lose);page.reload();open_account(name)
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/adopt')) as replay:editor().get_by_role('button',name='重试原请求',exact=True).click()
  assert replay.value.post_data==original_lost[1]['body'] and replay.value.headers['idempotency-key']==original_lost[1]['key'];expect(editor().get_by_text(re.compile('已采用并保留记录'))).to_be_visible();assert len(request(root+'/valuations')['items'])==1
  for fact in [{'kind':'fill','fill':{'instrument_id':iid,'side':'sell','quantity':'50','price':'11','fee':'1','tax':'0','source':'manual','settlement_amount':None}},{'kind':'cash','cash':{'kind':'deposit','amount':'1000'}}]:
   account=request(root);w=request(root+'/events',{'base_revision':account['revision'],'business_date':'2026-10-27',**fact},'POST');wait('investments/work',w['id'])
  page.get_by_role('button',name='刷新投资资料',exact=True).click();prepare('2026-10-27');end=submit_work(root);assert end['output']['balance']['equity']=='12099';adopt(root);assert all(not v['stale'] for v in request(root+'/valuations')['items'])
  workspace().get_by_role('button',name='区间绩效',exact=True).click();fill('绩效开始日期','2026-10-26',editor('区间绩效'));fill('绩效结束日期','2026-10-27',editor('区间绩效'));perf=submit_work(root,'区间绩效');assert perf['output']['net_profit']=='99' and perf['output']['net_deposit']=='1000' and perf['output']['maximum_drawdown_pct'] is None
  workspace().get_by_role('button',name='估值预览',exact=True).click();market(iid,'Synthetic second explicit source');prepare('2026-10-27');conflict=submit_work(root);assert conflict['output']['quotes'][0]['status']=='conflict' and conflict['output']['balance']['equity'] is None;editor().get_by_label('估值来源 '+iid,exact=True).select_option(source);chosen=submit_work(root);assert chosen['output']['balance']['equity']=='12099';adopt(root)
  workspace().get_by_role('button',name='期初修正',exact=True).click();fill('期初修正原因','  Synthetic audited baseline\nPreserve original explanation  ',editor('期初修正'));fill('修正期初现金','20000',editor('期初修正'));baseline=submit_work(root,'期初修正');assert baseline['output']['before']['opening_cash']=='10000' and baseline['output']['after']['opening_cash']=='20000';before=request(root+'/ledger?ledger_schema=2')['items'];adopt(root,'期初修正');assert request(root)['baseline_version']==2 and request(root+'/ledger?ledger_schema=2')['items']==before;assert all(v['stale'] for v in request(root+'/valuations')['items']);assert api.get('/api/v1/lighttick/'+root+'/ledger',headers=headers).status==409
  editor('期初修正').get_by_role('region',name='期初影响预览',exact=True).evaluate("e=>e.scrollIntoView({block:'start'})");page.screenshot(path=str(a.output/'baseline-preview.png'))
  fund=request('investments/instruments',{'code':str(int(token,16)%1000000).zfill(6),'market':'FUND','kind':'fund','name':'Synthetic fund '+token},'POST')['instrument'];fid='inv-'+str(uuid.uuid4());fname='Synthetic fund account '+token;froot='investments/accounts/'+fid;request(froot,{'base_revision':0,'name':fname,'currency':'CNY','baseline_date':'2026-10-26','opening_cash':'100','opening_positions':[{'instrument_id':fund['id'],'quantity':'10','cost':'50'}]},'PUT');
  for cash_kind in ['deposit','withdrawal']:
   fw=request(froot+'/events',{'base_revision':request(froot)['revision'],'business_date':'2026-10-26','kind':'cash','cash':{'kind':cash_kind,'amount':'1'}},'POST');wait('investments/work',fw['id'])
  page.get_by_role('button',name='刷新投资资料',exact=True).click();open_account(fname);workspace().get_by_text('基金净值与账实通知',exact=True).click();form=workspace().get_by_role('region',name='基金确认净值编辑',exact=True);form.get_by_label('核对事实标的',exact=True).select_option(fund['id']);fill('核对事实日期','2026-10-27',form);fill('已公布基金净值','10.1234567891',form);fill('基金净值来源说明','  Synthetic published NAV  ',form)
  with page.expect_response(lambda r:r.request.method=='PUT' and '/portfolio/facts/' in r.url) as pending:form.get_by_role('button',name='确认记录基金净值',exact=True).click()
  assert pending.value.status==200,pending.value.text();nav=pending.value.json()['data'];expect(form.get_by_text('此净值来源已确认并保留，原记录不覆盖。',exact=True)).to_be_visible();prepare('2026-10-27');value=submit_work(froot);assert value['output']['balance']['equity']=='201.234567891';adopt(froot)
  workspace().get_by_role('button',name='记录账实待核对',exact=True).click();form=workspace().get_by_role('region',name='账实通知编辑',exact=True);form.get_by_label('核对事实标的',exact=True).select_option(fund['id']);fill('核对事实日期','2026-10-27',form);fill('账实待核对说明','Synthetic corporate action awaiting evidence',form)
  with page.expect_response(lambda r:r.request.method=='PUT' and '/portfolio/facts/' in r.url) as pending:form.get_by_role('button',name='确认保存账实事项',exact=True).click()
  assert pending.value.status==200,pending.value.text();notice=pending.value.json()['data'];prepare('2026-10-27');unknown=submit_work(froot);assert unknown['output']['balance']['equity'] is None and unknown['output']['balance']['positions'][0]['quantity_verified'] is False;assert request(froot+'/ledger?ledger_schema=2')['unresolved_portfolio_notices']==1;expect(page.get_by_role('region',name='交易与现金流水',exact=True).get_by_role('alert')).to_contain_text('账实事项待核对');assert api.get('/api/v1/lighttick/'+froot+'/ledger',headers=headers).status==409
  remote={k:notice[k] for k in ['kind','instrument_id','date','notice_kind','reason','status','resolution','source_url']};remote.update({'base_revision':notice['revision'],'base_account_revision':request(froot)['revision'],'reason':'Synthetic cloud-only reconciliation note'});request(froot+'/portfolio/facts/'+notice['id'],remote,'PUT');form.get_by_label('账实事项状态',exact=True).select_option('resolved');fill('账实解除说明','Local audit resolution with confirmed source',form);form.get_by_role('button',name='确认保存账实事项',exact=True).click();expect(form.get_by_text(re.compile('本次提交被拒绝'))).to_be_visible();expect(form.get_by_label('账实解除说明',exact=True)).to_have_value('Local audit resolution with confirmed source');form.get_by_role('button',name='已核对，解除待核对状态',exact=True).click();form.get_by_role('button',name='核对事实与账户云端副本',exact=True).click();expect(form.get_by_label('账实事实三方核对',exact=True)).to_contain_text('Synthetic cloud-only reconciliation note');form.get_by_role('button',name='已比较，保留输入并采用事实基线',exact=True).click();form.get_by_role('button',name='确认保存账实事项',exact=True).click();expect(form.get_by_text('云端已确认。',exact=True)).to_be_visible();prepare('2026-10-27');resolved=submit_work(froot);assert resolved['output']['balance']['equity']=='201.234567891';assert 'unresolved_portfolio_notices' not in request(froot+'/ledger?ledger_schema=2');adopt(froot);workspace().get_by_role('button',name='查看事实历史 '+notice['id'],exact=True).click();expect(workspace().get_by_text('事实版本 3 · 2026-10-27',exact=True)).to_be_visible()
  editor().get_by_role('region',name='估值预览结果',exact=True).evaluate("e=>e.scrollIntoView({block:'start'})");page.screenshot(path=str(a.output/'valuation-and-nav.png'))
  for width in [320,375,768,1024]:page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
  page.set_viewport_size({'width':375,'height':900});editor().get_by_role('region',name='估值预览结果',exact=True).evaluate("e=>e.scrollIntoView({block:'start'})");page.screenshot(path=str(a.output/'portfolio-375.png'))
  export=request('review/export');assert hashlib.sha256(export['content'].encode()).hexdigest()==export['sha256'];doc=json.loads(export['content'])['investments']['portfolio'];assert any(e.get('id')==nav['id'] for e in doc['entries']);assert any(e.get('id')==notice['id'] and len(e.get('history',[]))==3 for e in doc['entries']);assert '"fence"' not in json.dumps(doc) and '"lease_until"' not in json.dumps(doc);assert errors==[],errors
  result={'passed':True,'served_revision':a.expected_grow_revision,'account':a.account,'account_id':aid,'fund_account_id':fid,'initial_equity':'11000','ending_equity':'12099','net_profit':'99','net_deposit':'1000','fund_equity':'201.234567891','preview_and_adoption_replay_exact_original_body_and_key':True,'source_conflict_requires_explicit_selection':True,'baseline_append_keeps_original_events_and_stales_old_values':True,'nav_immutable_and_notice_three_way_history':True,'open_notice_keeps_quantities_and_cash_unknown':True,'responsive_widths':[320,375,768,1024],'export_contains_sources_histories_contexts_and_originals':True,'page_errors':errors,'chrome_version':b.version}
 except Exception:
  page.screenshot(path=str(a.output/'failure.png'));(a.output/'failure-context.json').write_text(json.dumps({'account_id':aid,'account_name':name,'url':page.url,'page_errors':errors,'visible':page.locator('body').inner_text()[-12000:]},ensure_ascii=False,indent=2));raise
 finally:page.close(run_before_unload=False);api.dispose();b.close()
 result['browser_cleanup_completed']=True;(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print('GSTACK_STEP_OK',flush=True)
