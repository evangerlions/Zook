"""Deterministic synthetic localhost form records acceptance; no personal sessions or data."""
import argparse,json,re,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--expected-grow-revision',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert a.url=='http://127.0.0.1:58640' and re.fullmatch('[a-f0-9]{40}',a.expected_grow_revision)
a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True);page=context.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 api=pw.request.new_context(base_url=a.url)
 login=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':'alice@example.com','password':'Password1234','clientType':'app'});assert login.status==200,login.text()
 headers={'Authorization':'Bearer '+login.json()['data']['accessToken'],'X-App-Id':'lighttick'}
 def request(path,body=None,method='GET'):
  r=api.fetch('/api/v1/lighttick/'+path,method=method,data=body,headers={**headers,'Idempotency-Key':str(uuid.uuid4())});assert r.status==200,r.text();return r.json()['data']
 def section():return page.get_by_role('region',name='统计分类与局部表单数据',exact=True)
 def signin(account):
  page.get_by_label('邮箱或手机号',exact=True).fill(account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续',exact=True).click();expect(page.get_by_role('link',name='模型与设置',exact=True)).to_be_visible();page.get_by_role('link',name='模型与设置',exact=True).click();expect(section().get_by_role('button',name='载入云端局部表单副本',exact=True)).to_be_visible()
 def cloud():
  with page.expect_response(lambda r:r.request.method=='GET' and r.url.endswith('/form-records')) as read:section().get_by_role('button',name='核对云端局部表单',exact=True).click()
  assert read.value.status==200
  expect(section().get_by_role('button',name='核对云端局部表单',exact=True)).to_be_enabled()
 try:
  initial=request('form-records')
  if initial['revision']:request('form-records/clear',{'base_revision':initial['revision']},'POST')
  page.goto(a.url+'/grow/settings');signin('alice@example.com');assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text()
  section().get_by_role('button',name='载入云端局部表单副本',exact=True).click();section().get_by_label('新分类名称',exact=True).fill('Synthetic category');section().get_by_role('button',name='添加统计分类',exact=True).click()
  lost=[]
  def lose(route):
   if route.request.method not in ['PUT','POST']:return route.continue_()
   response=route.fetch();assert response.status==200,response.text();lost.append({'body':route.request.post_data,'key':route.request.headers['idempotency-key'],'data':response.json()['data']});route.fulfill(status=503,content_type='application/json',body='{"code":"SYNTHETIC_LOST_RESPONSE","message":"Synthetic response lost"}')
  page.route('**/api/v1/lighttick/form-records',lose);section().get_by_role('button',name='保存分类与局部表单',exact=True).click();expect(section().get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/api/v1/lighttick/form-records',lose)
  page.get_by_role('button',name='退出登录',exact=True).click();signin('bob@example.com');expect(section().get_by_role('button',name='重试原请求',exact=True)).to_have_count(0);expect(section().get_by_label('分类名称',exact=True)).to_have_count(0)
  page.get_by_role('button',name='退出登录',exact=True).click();signin('alice@example.com');expect(section().get_by_role('button',name='重试原请求',exact=True)).to_be_visible();page.reload();expect(section().get_by_role('button',name='重试原请求',exact=True)).to_be_visible()
  with page.expect_request(lambda r:r.method=='PUT' and r.url.endswith('/form-records')) as replay:section().get_by_role('button',name='重试原请求',exact=True).click()
  assert replay.value.post_data==lost[0]['body'] and replay.value.headers['idempotency-key']==lost[0]['key'];expect(section().get_by_text('云端已确认。',exact=True)).to_be_visible();assert request('form-records')['revision']==lost[0]['data']['revision']
  section().get_by_label('分类名称',exact=True).fill('Local edited name');remote=request('form-records');remote['data']['modules'][0]['name']='Remote edited name';request('form-records',{'base_revision':remote['revision'],'data':remote['data']},'PUT')
  section().get_by_role('button',name='保存分类与局部表单',exact=True).click();expect(section().get_by_text(re.compile('本次提交被拒绝'))).to_be_visible();expect(section().get_by_label('分类名称',exact=True)).to_have_value('Local edited name');cloud();section().get_by_role('button',name='已核对，解除待核对状态',exact=True).click();section().get_by_role('button',name='已比较，保留输入并采用云端基线',exact=True).click();section().get_by_role('button',name='保存分类与局部表单',exact=True).click();expect(section().get_by_text('云端已确认。',exact=True)).to_be_visible();assert request('form-records')['data']['modules'][0]['name']=='Local edited name'
  context.set_offline(True);section().get_by_label('分类名称',exact=True).fill('Offline preserved name');section().get_by_role('button',name='保存分类与局部表单',exact=True).click();expect(section().get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();context.set_offline(False);page.reload();expect(section().get_by_label('分类名称',exact=True)).to_have_value('Offline preserved name');section().get_by_role('button',name='重试原请求',exact=True).click();expect(section().get_by_text('云端已确认。',exact=True)).to_be_visible()
  with page.expect_download() as event:section().get_by_role('button',name='导出云端局部表单副本',exact=True).click()
  downloaded=json.loads(Path(event.value.path()).read_text());assert downloaded['scope']=='lighttick_partial_form_records' and downloaded['snapshot']['data']['modules'][0]['name']=='Offline preserved name'
  record='record-form-browser-'+uuid.uuid4().hex;request('records/'+record,{'base_version':0,'raw_text':'Independent record survives form clear','record_date':'2026-11-08','prompt_kind':'free','guided_answers':{},'tags':[]},'PUT')
  section().get_by_text('清空局部表单记录',exact=True).click();section().get_by_label('清空确认文字',exact=True).fill('清空局部表单');expect(section().get_by_role('button',name='确认清空局部表单',exact=True)).to_be_enabled()
  for width in [320,375,768,1440]:
   page.set_viewport_size({'width':width,'height':1000});section().scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
   if width==375:page.screenshot(path=str(a.output/'forms-375.png'))
  page.set_viewport_size({'width':1440,'height':1000});page.route('**/api/v1/lighttick/form-records/clear',lose);section().get_by_role('button',name='确认清空局部表单',exact=True).click();expect(section().get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/api/v1/lighttick/form-records/clear',lose);page.reload();expect(section().get_by_role('button',name='重试原请求',exact=True)).to_be_visible()
  with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/form-records/clear')) as clear_replay:section().get_by_role('button',name='重试原请求',exact=True).click()
  assert clear_replay.value.post_data==lost[1]['body'] and clear_replay.value.headers['idempotency-key']==lost[1]['key'];expect(section().get_by_label('分类名称',exact=True)).to_have_count(0);assert request('form-records')['revision']==lost[1]['data']['revision'];assert request('records/'+record)['raw_text']=='Independent record survives form clear';assert request('form-records')['data']['modules']==[]
  section().get_by_text('完成与进度说明',exact=True).click();section().scroll_into_view_if_needed();page.screenshot(path=str(a.output/'forms-desktop.png'));assert errors==[],errors
  result={'passed':True,'served_revision':a.expected_grow_revision,'browser':browser.version,'exact_original_request_after_response_loss_reload_and_account_switch':True,'conflict_keeps_input_until_explicit_comparison':True,'offline_recovery':True,'scoped_download_and_clear':True,'independent_record_survives_clear':True,'widths':[320,375,768,1440],'clear_response_loss_replays_original_without_clearing_again':True,'independent_record_id':record,'final_snapshot':request('form-records'),'page_errors':errors}
  (a.output/'browser-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
 except Exception:
  page.screenshot(path=str(a.output/'failure.png'));raise
 finally:browser.close()
