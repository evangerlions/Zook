"""Disposable localhost PG/worker/Chrome acceptance. All identities, CSVs and provider failures are synthetic."""
import argparse,json,uuid,time,hashlib,re,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',required=True,type=Path);p.add_argument('--account',default='course6@example.com');a=p.parse_args();assert a.url.startswith('http://127.0.0.1:') and re.fullmatch(r'course\d+@example.com',a.account);a.output.mkdir(parents=True,exist_ok=True)
end=time.monotonic()+20
while True:
 try:urllib.request.urlopen(a.url+'/grow/',timeout=1).close();break
 except Exception:
  if time.monotonic()>end:raise
  time.sleep(.1)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,channel='chrome');c=b.new_context(viewport={'width':1440,'height':1100});page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  api=pw.request.new_context(base_url=a.url);auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':a.account,'password':'Password1234','clientType':'app'}).json()['data'];h={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'};key=lambda:{**h,'Idempotency-Key':str(uuid.uuid4())};label='日线合成 '+uuid.uuid4().hex[:8]
  for _ in range(10):
   code='600'+str(uuid.uuid4().int%1000).zfill(3);response=api.post('/api/v1/lighttick/investments/instruments',headers=key(),data={'market':'SSE','code':code,'kind':'stock','name':label});assert response.status==200,response.text()
   if not response.json()['data']['existing']:break
  else:raise AssertionError('synthetic code range exhausted')
  sid=response.json()['data']['instrument']['id'];assert not api.get('/api/v1/lighttick/investments/accounts',headers=h).json()['data']['items']
  csv='\ufeffdate,open,high,low,close,volume,amount\r\n'+''.join(f'2026-10-{day},10,12,9,11,0.0000000001,9007199254740993.0000000001\r\n' for day in [28,29,30])
  page.goto(a.url+'/grow/investments');page.get_by_label('邮箱或手机号').fill(a.account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();page.get_by_role('button',name=label+' · '+code+' · SSE',exact=True).click();v=page.get_by_role('region',name='日线行情与研究资料');expect(v).to_be_visible()
  v.get_by_label('行情开始日期',exact=True).fill('2026-10-28');v.get_by_label('行情结束日期',exact=True).fill('2026-10-30');v.get_by_label('CSV 来源声明',exact=True).fill(label+' 资料');v.get_by_label('选择 CSV 文件',exact=True).set_input_files({'name':'synthetic.csv','mimeType':'text/csv','buffer':csv.encode()});expect(v.get_by_label('CSV 日线内容',exact=True)).to_have_value(csv.replace('\r\n','\n'))
  original=[];work=[]
  def lose(route):
   if route.request.method=='POST':
    response=route.fetch();assert response.status==200,response.text();original.append((route.request.post_data,route.request.headers['idempotency-key'],route.request.url));work.append(response.json()['data']['id']);route.abort('failed')
   else:route.continue_()
  page.route('**/investments/market/work',lose);v.get_by_role('button',name='确认提交行情任务',exact=True).click();expect(v.get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/investments/market/work',lose);page.reload();page.get_by_role('button',name=label+' · '+code+' · SSE',exact=True).click();expect(v.get_by_label('CSV 日线内容',exact=True)).to_have_value(csv.replace('\r\n','\n'))
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/investments/market/work')) as retry:v.get_by_role('button',name='重试原请求',exact=True).click()
  r=retry.value;assert (r.post_data,r.headers['idempotency-key'],r.url)==original[0];assert json.loads(r.post_data)['csv']==csv;expect(v.get_by_text('行情任务：succeeded · 修订 3',exact=True)).to_be_visible(timeout=20000);expect(v.get_by_role('heading',name='已确认日线快照',exact=True)).to_be_visible();expect(v.get_by_role('cell',name='9007199254740993.0000000001',exact=True)).to_have_count(3)
  first=api.get('/api/v1/lighttick/investments/market/work/'+work[0],headers=h).json()['data']['snapshot_id'];page.reload();page.get_by_role('button',name=label+' · '+code+' · SSE',exact=True).click();expect(v.get_by_role('heading',name='已确认日线快照',exact=True)).to_be_visible(timeout=10000)
  def new():
   v.get_by_role('button',name='核对云端标的基线',exact=True).click();v.get_by_role('button',name='已核对，保留输入并开始新行情任务',exact=True).click();expect(v.get_by_role('complementary',name='行情任务回执')).not_to_be_visible()
  new();changed=api.put('/api/v1/lighttick/investments/instruments/'+sid,headers=key(),data={'base_revision':1,'name':label+' 云端','archived':False});assert changed.status==200,changed.text();v.get_by_role('button',name='确认提交行情任务',exact=True).click();expect(v.get_by_role('button',name='已核对，解除待核对状态',exact=True)).to_be_visible();v.get_by_role('button',name='核对云端标的基线',exact=True).click();expect(v.get_by_text(re.compile('云端标的修订 2'))).to_be_visible();expect(v.get_by_label('CSV 日线内容',exact=True)).to_have_value(csv.replace('\r\n','\n'));v.get_by_role('button',name='已核对，解除待核对状态',exact=True).click();v.get_by_role('button',name='已核对，保留输入并开始新行情任务',exact=True).click();expect(v.get_by_role('complementary',name='行情任务回执')).not_to_be_visible()
  v.get_by_label('日线来源',exact=True).select_option('eastmoney')
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/investments/market/work')) as network:v.get_by_role('button',name='确认提交行情任务',exact=True).click()
  assert 'csv' not in network.value.post_data_json and 'token' not in network.value.post_data_json;expect(v.get_by_text('行情任务：failed · 修订 3',exact=True)).to_be_visible(timeout=20000);expect(v.get_by_role('alert').filter(has_text='HTTP_ERROR')).to_be_visible();assert len(api.get('/api/v1/lighttick/investments/market/snapshots?instrument_id='+sid,headers=h).json()['data']['items'])==1
  new();v.get_by_label('行情开始日期',exact=True).fill('2026-10-29');v.get_by_role('button',name='确认提交行情任务',exact=True).click();expect(v.get_by_text('行情任务：running · 修订 2',exact=True)).to_be_visible(timeout=10000)
  adopt=v.get_by_role('button',name='已核对，采用当前任务修订',exact=True)
  if adopt.is_visible():adopt.click()
  v.get_by_role('button',name='取消行情任务',exact=True).click();expect(v.get_by_text('行情任务：cancelled · 修订 3',exact=True)).to_be_visible(timeout=10000);assert len(api.get('/api/v1/lighttick/investments/market/snapshots?instrument_id='+sid,headers=h).json()['data']['items'])==1
  new();v.get_by_label('日线来源',exact=True).select_option('csv');expect(v.get_by_label('CSV 日线内容',exact=True)).to_have_value(csv.replace('\r\n','\n'));c.set_offline(True);v.get_by_role('button',name='刷新行情资料',exact=True).click();expect(v.get_by_role('heading',name='已确认日线快照',exact=True)).not_to_be_visible();expect(v.get_by_label('CSV 日线内容',exact=True)).to_have_value(csv.replace('\r\n','\n'));c.set_offline(False);page.evaluate("window.dispatchEvent(new Event('online'))")
  body={'instrument_id':sid,'base_revision':2,'supplier':'csv','start':'2026-10-28','end':'2026-10-30','csv':csv,'declared_source':label,'volume_unit':'shares','amount_unit':'CNY'}
  def append():
   r=api.post('/api/v1/lighttick/investments/market/work',headers=key(),data=body);assert r.status==200,r.text();wid=r.json()['data']['id'];end=time.monotonic()+15
   while time.monotonic()<end:
    w=api.get('/api/v1/lighttick/investments/market/work/'+wid,headers=h).json()['data']
    if w['status'] in ['succeeded','failed','cancelled']:assert w['status']=='succeeded',w;return
    time.sleep(.05)
   raise AssertionError('synthetic worker failed to reach terminal')
  for _ in range(21):append()
  v.get_by_role('button',name='刷新行情资料',exact=True).click();expect(v.get_by_role('button',name='更多行情快照',exact=True)).to_be_visible();append();v.get_by_role('button',name='更多行情快照',exact=True).click();expect(v.get_by_role('alert').filter(has_text='本机输入和原请求仍保留')).to_be_visible();expect(v.get_by_label('CSV 日线内容',exact=True)).to_have_value(csv.replace('\r\n','\n'));v.get_by_role('button',name='刷新行情资料',exact=True).click();v.get_by_role('button',name='更多行情快照',exact=True).click();expect(v.get_by_role('button',name=re.compile('2026-10-28 至 2026-10-30 · CSV 导入 · 3 条'))).to_have_count(23)
  exported=api.get('/api/v1/lighttick/review/export',headers=h);assert exported.status==200,exported.text();doc=exported.json()['data'];assert hashlib.sha256(doc['content'].encode()).hexdigest()==doc['sha256'];market=json.loads(doc['content'])['investments']['market'];assert len([s for s in market['snapshots'] if s['instrument_id']==sid])==23;receipt=next(w for w in market['receipts'] if w['id']==work[0]);assert receipt['request_body']['csv']==csv and receipt['status']=='succeeded' and 'fence' not in receipt and 'lease_until' not in receipt
  assert not api.get('/api/v1/lighttick/investments/accounts',headers=h).json()['data']['items'];other=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':'course8@example.com','password':'Password1234','clientType':'app'}).json()['data'];assert api.get('/api/v1/lighttick/investments/market/snapshots/'+first,headers={'Authorization':'Bearer '+other['accessToken'],'X-App-Id':'lighttick'}).status==404
  v.get_by_label('CSV 来源声明',exact=True).focus();page.keyboard.press('Tab');expect(v.get_by_label('CSV 成交量单位',exact=True)).to_be_focused();page.screenshot(path=str(a.output/'market-desktop.png'),full_page=True)
  for width in [320,375,768,1024]:
   page.set_viewport_size({'width':width,'height':900})
   if not page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'):
    (a.output/'layout.json').write_text(json.dumps(page.evaluate("[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(e).position!=='absolute').map(e=>({tag:e.tagName,classes:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).slice(0,30)"),indent=2));raise AssertionError(width)
  page.screenshot(path=str(a.output/'market-mobile.png'),full_page=True);assert not errors,errors
  (a.output/'result.json').write_text(json.dumps({'passed':True,'instrument_id':sid,'snapshots':23,'no_asset_account_required':True,'exact_CSV_bytes_and_original_request_replay':True,'decimal_precision':True,'work_reference_recovers_on_reload':True,'explicit_instrument_CAS_rebase':True,'selected_supplier_failure_no_fallback':True,'live_cancel_no_late_snapshot':True,'offline_and_expired_cursor_keep_drafts':True,'authorized_export_original_receipts':True,'cross_owner_denied':True,'keyboard_and_320_375_768_1024_widths':True,'console_errors':errors},ensure_ascii=False,indent=2))
 except Exception:page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:b.close()
