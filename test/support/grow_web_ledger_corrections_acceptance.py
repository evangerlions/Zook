# -*- coding: utf-8 -*-
"""Synthetic localhost real-PG/worker/Chrome correction and compensation story."""
import argparse,json,time,uuid,hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--expected-grow-revision',required=True);p.add_argument('--output',required=True,type=Path);a=p.parse_args();assert a.url.startswith('http://127.0.0.1:');a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True);context=b.new_context(viewport={'width':1440,'height':1000});page=context.new_page();api=pw.request.new_context(base_url=a.url);page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':'course7@example.com','password':'Password1234','clientType':'app'}).json()['data'];headers={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'};aid='inv-'+str(uuid.uuid4());name='Synthetic correction '+uuid.uuid4().hex[:7];root='/api/v1/lighttick/investments/accounts/'+aid
 def req(path,body=None,method='GET',key=None):
  r=api.fetch(path,headers={**headers,'Idempotency-Key':key or str(uuid.uuid4())},method=method,data=body);assert r.status==200,r.text();return r.json()['data']
 def wait(wid):
  end=time.monotonic()+20
  while time.monotonic()<end:
   w=req('/api/v1/lighttick/investments/work/'+wid)
   if w['status'] not in ['queued','running']:assert w['status']=='succeeded',w;return w
   time.sleep(.1)
  raise AssertionError('Worker did not complete')
 def ledger():return req(root+'/ledger?ledger_schema=2')
 def view():return page.get_by_role('region',name='交易与现金流水',exact=True)
 def panel():return view().get_by_role('region',name='账本纠错与补偿',exact=True)
 def choose(wid):view().get_by_role('button',name='核对或纠错 '+wid,exact=True).click()
 def submit():
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith(root+'/events')) as pending:panel().get_by_role('button',name='确认追加纠错命令',exact=True).click()
  assert pending.value.status==200,pending.value.text();w=pending.value.json()['data'];wait(w['id']);expect(panel().get_by_label('账本命令回执',exact=True)).to_contain_text('succeeded');return w['id']
 try:
  req(root,{'base_revision':0,'name':name,'currency':'CNY','baseline_date':'2026-01-01','opening_cash':'100','opening_positions':[]},'PUT')
  original=req(root+'/events',{'base_revision':1,'kind':'cash','business_date':'2026-11-01','cash':{'kind':'deposit','amount':'1.25'}},'POST');wait(original['id']);raw_original=ledger()['items'][0]['input']
  page.goto(a.url+'/grow/investments');page.get_by_label('邮箱或手机号').fill('course7@example.com');page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续',exact=True).click();expect(page.get_by_role('button',name=name+' · 使用中',exact=True)).to_be_visible();page.get_by_role('button',name=name+' · 使用中',exact=True).click()
  assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text();choose(original['id']);reason='  Preserve original explanation\nSynthetic amount correction  ';panel().get_by_label('纠错原因',exact=True).fill(reason);panel().get_by_label('现金金额',exact=True).fill('2.5000000000')
  lost=[]
  def lose(route):
   response=route.fetch();assert response.status==200,response.text();lost.append({'body':route.request.post_data,'key':route.request.headers['idempotency-key'],'work':response.json()['data']});route.abort('failed')
  page.route('**'+root+'/events',lose);panel().get_by_role('button',name='确认追加纠错命令',exact=True).click();expect(panel().get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**'+root+'/events',lose);assert len(lost)==1;wait(lost[0]['work']['id'])
  page.reload();page.get_by_role('button',name=name+' · 使用中',exact=True).click();choose(original['id']);expect(panel().get_by_label('纠错原因',exact=True)).to_have_value(reason)
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith(root+'/events')) as replay:panel().get_by_role('button',name='重试原请求',exact=True).click()
  assert replay.value.post_data==lost[0]['body'];assert replay.value.headers['idempotency-key']==lost[0]['key'];expect(panel().get_by_label('账本命令回执',exact=True)).to_contain_text('succeeded');c=lost[0]['work']['id'];assert ledger()['report']['result']['cash']=='102.5';assert ledger()['items'][0]['input']==raw_original
  choose(c);panel().get_by_label('纠错原因',exact=True).fill('Synthetic explicit void');panel().get_by_label('纠错方式',exact=True).select_option('void');v=submit();assert ledger()['report']['result']['cash']=='100'
  choose(v);panel().get_by_label('纠错原因',exact=True).fill('Compensate void with confirmed cash fact');panel().get_by_label('流水类型',exact=True).select_option('cash');panel().get_by_label('现金金额',exact=True).fill('0.7500000000');restored=submit();final=ledger();assert final['report']['result']['cash']=='100.75';assert final['report']['event_count']==4;assert final['report']['effective_event_count']==1;assert final['report']['correction_count']==3
  expect(panel().get_by_role('status').filter(has_text='目标已被后续纠错替代')).to_be_visible()
  panel().get_by_role('button',name='核对当前账户纠错基线',exact=True).click();panel().get_by_role('button',name='已比较，保留输入并采用当前账户基线',exact=True).click();expect(panel().get_by_role('button',name='确认追加纠错命令',exact=True)).to_be_disabled()
  assert api.get(root+'/ledger',headers=headers).status==409
  export=req('/api/v1/lighttick/review/export');assert hashlib.sha256(export['content'].encode()).hexdigest()==export['sha256'];record=next(x for x in json.loads(export['content'])['investments']['ledgers'] if x['account_id']==aid);assert len(record['events'])==4 and len(record['receipts'])==4;assert next(r for r in record['receipts'] if r['id']==c)['request_body']==json.loads(lost[0]['body'])
  other=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':'course8@example.com','password':'Password1234','clientType':'app'}).json()['data'];assert api.get(root+'/ledger?ledger_schema=2',headers={'Authorization':'Bearer '+other['accessToken'],'X-App-Id':'lighttick'}).status==404
  view().get_by_role('heading',name='交易与现金流水',exact=True).scroll_into_view_if_needed();page.screenshot(path=str(a.output/'correction-chain.png'))
  for width in [320,375,768,1024]:page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
  page.set_viewport_size({'width':375,'height':900});panel().get_by_role('heading',name='核对并追加纠错',exact=True).scroll_into_view_if_needed();page.screenshot(path=str(a.output/'correction-375.png'));assert errors==[],errors
  result={'passed':True,'served_revision':a.expected_grow_revision,'account_id':aid,'account_name':name,'original':original['id'],'correction':c,'void':v,'compensation':restored,'raw_original_preserved':True,'lost_response_replays_exact_original_body_and_key':True,'precision_and_chain_cash':['101.25','102.5','100','100.75'],'raw_events':4,'effective_events':1,'corrections':3,'old_schema_explicit_upgrade':True,'foreign_owner_denied':True,'export_contains_originals_and_chain':True,'responsive_widths':[320,375,768,1024],'page_errors':errors,'chrome_version':b.version}
 except Exception:
  (a.output/'failure-context.json').write_text(json.dumps({'account_id':aid,'account_name':name,'layout':page.evaluate('''() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(e=>({tag:e.tagName,role:e.getAttribute('aria-label'),text:e.textContent?.slice(0,80),right:e.getBoundingClientRect().right}))})''')},ensure_ascii=False,indent=2));page.screenshot(path=str(a.output/'failure.png'));raise
 finally:page.close(run_before_unload=False);api.dispose();b.close()
 result['browser_cleanup_completed']=True;(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print('GSTACK_STEP_OK',flush=True)
