"""Synthetic real-PG/worker/Chrome ledger acceptance, with no real holdings or market requests."""
import argparse,json,uuid,time,hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',required=True,type=Path);p.add_argument('--account',default='course3@example.com');a=p.parse_args();assert a.url.startswith('http://127.0.0.1:') and a.account.startswith('course') and a.account.endswith('@example.com');a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,channel='chrome');c=b.new_context(viewport={'width':1440,'height':1100});page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  api=pw.request.new_context(base_url=a.url);auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':a.account,'password':'Password1234','clientType':'app'}).json()['data'];h={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'};key=lambda:{**h,'Idempotency-Key':str(uuid.uuid4())}
  name='账本合成 '+uuid.uuid4().hex[:8];aid='inv-'+str(uuid.uuid4());root='/api/v1/lighttick/investments/accounts/'+aid
  response=api.post('/api/v1/lighttick/investments/instruments',headers=key(),data={'code':'LEDGER'+uuid.uuid4().hex[:8].upper(),'market':'SSE','kind':'stock','name':name+' 标的'});assert response.status==200,response.text();sid=response.json()['data']['instrument']['id']
  response=api.put(root,headers=key(),data={'base_revision':0,'name':name,'currency':'CNY','baseline_date':'2026-01-01','opening_cash':'100','opening_positions':[{'instrument_id':sid,'quantity':'1','cost':None}]});assert response.status==200,response.text()
  page.goto(a.url+'/grow/investments');page.get_by_label('邮箱或手机号').fill(a.account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();page.get_by_role('button',name=name+' · 使用中',exact=True).click();v=page.get_by_role('region',name='交易与现金流水');expect(v).to_be_visible()
  v.get_by_label('成交标的',exact=True).select_option(sid);v.get_by_label('成交价格 / 确认净值',exact=True).fill('0.1000000000');v.get_by_label('成交份额',exact=True).fill('3');tuples=[];accepted=[]
  def lose(route):
   if route.request.method=='POST':
    tuples.append((route.request.post_data,route.request.headers.get('idempotency-key'),route.request.url));response=route.fetch();assert response.status==200,response.text();accepted.append(response.json()['data']['id']);route.abort()
   else:route.continue_()
  page.route('**/investments/accounts/'+aid+'/events',lose);v.get_by_role('button',name='确认提交账本命令',exact=True).click();expect(v.get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/investments/accounts/'+aid+'/events',lose);page.reload();page.get_by_role('button',name=name+' · 使用中',exact=True).click();expect(v.get_by_label('成交价格 / 确认净值',exact=True)).to_have_value('0.1000000000');expect(v.get_by_label('成交份额',exact=True)).to_have_value('3')
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/investments/accounts/'+aid+'/events')) as retried:v.get_by_role('button',name='重试原请求',exact=True).click()
  r=retried.value;assert (r.post_data,r.headers.get('idempotency-key'),r.url)==tuples[0];expect(v.get_by_text('命令状态：succeeded · 修订 3',exact=True)).to_be_visible(timeout=20000);expect(v.get_by_text('现金 99.7 CNY · 暂估，资料未齐',exact=True)).to_be_visible();expect(v.get_by_text(name+' 标的 · 份额 4 · 成本 未知 · 浮动收益 未知',exact=True)).to_be_visible()
  page.reload();page.get_by_role('button',name=name+' · 使用中',exact=True).click();expect(v.get_by_text('命令状态：succeeded · 修订 3',exact=True)).to_be_visible(timeout=10000);assert len(api.get(root+'/ledger',headers=h).json()['data']['items'])==1
  def new():
   v.get_by_role('button',name='核对云端账本基线',exact=True).click();v.get_by_role('button',name='已核对，保留输入并开始新命令',exact=True).click()
  new();v.get_by_label('流水类型',exact=True).select_option('cash');v.get_by_label('现金金额',exact=True).fill('0.0000000001');v.get_by_role('button',name='确认提交账本命令',exact=True).click();expect(v.get_by_text('命令状态：succeeded · 修订 3',exact=True)).to_be_visible(timeout=20000);expect(v.get_by_text('现金 99.7000000001 CNY · 暂估，资料未齐',exact=True)).to_be_visible()
  new();v.get_by_label('流水类型',exact=True).select_option('fill');v.get_by_label('方向',exact=True).select_option('sell');v.get_by_label('成交份额',exact=True).fill('999');v.get_by_role('button',name='确认提交账本命令',exact=True).click();expect(v.get_by_text('命令状态：failed · 修订 3',exact=True)).to_be_visible(timeout=20000);assert len(api.get(root+'/ledger',headers=h).json()['data']['items'])==2
  c.set_offline(True);v.get_by_role('button',name='重建流水读取',exact=True).click();expect(v.get_by_label('成交份额',exact=True)).to_have_value('999');expect(v.get_by_role('heading',name='已确认流水的计算快照',exact=True)).not_to_be_visible();c.set_offline(False);page.evaluate("window.dispatchEvent(new Event('online'))");expect(v.get_by_text('命令状态：failed · 修订 3',exact=True)).to_be_visible(timeout=10000)
  def append_cash():
   account=api.get(root,headers=h).json()['data'];response=api.post(root+'/events',headers=key(),data={'base_revision':account['revision'],'business_date':'2026-11-04','kind':'cash','cash':{'kind':'deposit','amount':'0.0000000001'}});assert response.status==200,response.text();wid=response.json()['data']['id'];end=time.monotonic()+15
   while time.monotonic()<end:
    result=api.get('/api/v1/lighttick/investments/work/'+wid,headers=h).json()['data']
    if result['status'] in ['succeeded','failed','cancelled']:assert result['status']=='succeeded',result;return
    time.sleep(.05)
   raise AssertionError('synthetic worker did not reach terminal')
  for _ in range(25):append_cash()
  v.get_by_role('button',name='重建流水读取',exact=True).click();expect(v.get_by_role('button',name='更多正式流水',exact=True)).to_be_visible();append_cash();v.get_by_role('button',name='更多正式流水',exact=True).click();expect(v.get_by_role('alert').filter(has_text='本机输入和原请求仍保留')).to_be_visible();expect(v.get_by_label('成交份额',exact=True)).to_have_value('999');v.get_by_role('button',name='重建流水读取',exact=True).click();v.get_by_role('button',name='更多正式流水',exact=True).click();expect(v.locator('ol > li')).to_have_count(28)
  exported=api.get('/api/v1/lighttick/review/export',headers=h);assert exported.status==200,exported.text();data=exported.json()['data'];assert hashlib.sha256(data['content'].encode()).hexdigest()==data['sha256'];body=json.loads(data['content']);ledger=next(x for x in body['investments']['ledgers'] if x['account_id']==aid);assert len(ledger['events'])==28;receipt=next(x for x in ledger['receipts'] if x['id']==accepted[0]);assert receipt['request_body']['fill']['price']=='0.1000000000' and receipt['status']=='succeeded' and 'fence' not in receipt
  other=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':'course8@example.com','password':'Password1234','clientType':'app'}).json()['data'];assert api.get('/api/v1/lighttick/investments/work/'+accepted[0],headers={'Authorization':'Bearer '+other['accessToken'],'X-App-Id':'lighttick'}).status==404
  page.screenshot(path=str(a.output/'investment-ledger-desktop.png'),full_page=True);page.set_viewport_size({'width':375,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.screenshot(path=str(a.output/'investment-ledger-mobile.png'),full_page=True);assert not errors,errors
  (a.output/'result.json').write_text(json.dumps({'passed':True,'account_id':aid,'instrument_id':sid,'worker_commit_count':28,'lost_response_exact_replay':True,'pending_work_recovers_on_reload':True,'unknown_fee_and_cost_stay_unknown':True,'cash_decimal_precision':True,'oversell_no_fact':True,'expired_cursor_rebuild_keeps_draft':True,'offline_draft_kept':True,'authorized_export_original_receipts':True,'owner_isolation':True,'console_errors':errors},ensure_ascii=False,indent=2))
 except Exception:page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:b.close()
