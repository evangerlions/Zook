"""Synthetic localhost-only, real browser/HTTP/PG acceptance for legacy form editing."""
import argparse,json,re,time,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--expected-grow-revision',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert a.url=='http://127.0.0.1:58642' and re.fullmatch('[a-f0-9]{40}',a.expected_grow_revision)
a.output.mkdir(parents=True,exist_ok=True)
golden=json.loads((Path(__file__).resolve().parents[1]/'fixtures/lighttick/form-editors-golden.json').read_text())
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
 page=context.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 api=pw.request.new_context(base_url=a.url)
 auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':'alice@example.com','password':'Password1234','clientType':'app'});assert auth.status==200,auth.text();headers={'Authorization':'Bearer '+auth.json()['data']['accessToken'],'X-App-Id':'lighttick'}
 def request(path,body=None,method='GET'):
  r=api.fetch('/api/v1/lighttick/'+path,method=method,data=body,headers={**headers,'Idempotency-Key':str(uuid.uuid4())});assert r.status==200,r.text();return r.json()['data']
 def ws(label):return page.get_by_role('region',name=label+'表单工作区',exact=True)
 def ed(label):return ws(label).get_by_role('group',name='当前表单编辑',exact=True)
 def choose(label):
  page.get_by_role('navigation',name='表单栏目',exact=True).get_by_role('button',name=label,exact=True).click();expect(ws(label).get_by_role('button',name='载入云端本栏副本',exact=True)).to_be_enabled()
 def load(label):ws(label).get_by_role('button',name='载入云端本栏副本',exact=True).click();expect(ws(label).get_by_role('button',name='确认保存本栏到云端',exact=True)).to_be_visible()
 def signin(account):
  page.get_by_label('邮箱或手机号',exact=True).fill(account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续',exact=True).click();expect(page.get_by_role('link',name='表单记录',exact=True)).to_be_visible();page.get_by_role('link',name='表单记录',exact=True).click();expect(ws('决策').get_by_role('button',name='载入云端本栏副本',exact=True)).to_be_visible();expect(ws('决策').get_by_role('button',name='核对云端表单',exact=True)).to_be_enabled()
 def fill(label,field,value):ed(label).get_by_label(field,exact=True).fill(value)
 def join(label):ed(label).get_by_role('button',name='加入本机列表',exact=True).click();expect(ws(label).get_by_role('group',name='当前表单编辑',exact=True)).to_have_count(0)
 def save(label):
  with page.expect_response(lambda r:r.request.method=='PATCH' and '/form-records/sections/' in r.url) as response:ws(label).get_by_role('button',name='确认保存本栏到云端',exact=True).click()
  assert response.value.status==200,response.value.text();expect(ws(label).get_by_text('云端已确认。',exact=True)).to_be_visible();return response.value.json()['data']
 try:
  initial=request('form-records');data={**initial['data'],**{k:v for k,v in golden['values'].items() if k!='custom'},**golden['values']['custom']};data['habits']['2026-11-07']={'minutes':25,'note':'Earlier manual note'}
  request('form-records',{'base_revision':initial['revision'],'data':data},'PUT');before_core=json.loads(request('review/export')['content'])
  page.goto(a.url+'/grow/forms');signin('alice@example.com');assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text();load('决策')
  ws('决策').get_by_role('button',name='编辑第 1 条',exact=True).click();fill('决策','决策事项','Unsaved survives reload');page.reload();expect(ed('决策').get_by_label('决策事项',exact=True)).to_have_value('Unsaved survives reload')
  choose('洞见');load('洞见');choose('决策');expect(ed('决策').get_by_label('决策事项',exact=True)).to_have_value('Unsaved survives reload');fill('决策','自报概率 %','0');fill('决策','实际结果（复盘填）','Reviewed synthetic result');join('决策')
  lost=[]
  def lose(route):
   if route.request.method!='PATCH':return route.continue_()
   response=route.fetch();assert response.status==200,response.text();lost.append({'body':route.request.post_data,'key':route.request.headers['idempotency-key'],'data':response.json()['data']});route.fulfill(status=503,content_type='application/json',body='{"code":"SYNTHETIC_LOST_RESPONSE","message":"Synthetic response lost"}')
  page.route('**/form-records/sections/decisions',lose);ws('决策').get_by_role('button',name='确认保存本栏到云端',exact=True).click();expect(ws('决策').get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/form-records/sections/decisions',lose)
  page.get_by_role('button',name='退出登录',exact=True).click();signin('bob@example.com');expect(ws('决策').get_by_role('button',name='重试原请求',exact=True)).to_have_count(0);load('决策');expect(ws('决策').get_by_role('button',name='编辑第 1 条',exact=True)).to_have_count(0)
  ws('决策').get_by_role('button',name='新增决策',exact=True).click();fill('决策','决策事项','Bob private draft only');page.get_by_role('button',name='退出登录',exact=True).click();signin('alice@example.com');page.reload();expect(ws('决策').get_by_role('button',name='重试原请求',exact=True)).to_be_visible()
  with page.expect_request(lambda r:r.method=='PATCH' and r.url.endswith('/sections/decisions')) as replay:ws('决策').get_by_role('button',name='重试原请求',exact=True).click()
  assert replay.value.post_data==lost[0]['body'] and replay.value.headers['idempotency-key']==lost[0]['key'];expect(ws('决策').get_by_text('云端已确认。',exact=True)).to_be_visible();assert request('form-records')['revision']==lost[0]['data']['revision'];assert request('form-records')['data']['decisions'][0]['legacy_origin']=='Retained'
  ws('决策').get_by_role('button',name='编辑第 1 条',exact=True).click();fill('决策','背景与约束','Local conflict input');expect(ws('决策').get_by_text('本机修改已保存，尚未提交云端。',exact=True)).to_be_visible();join('决策')
  def conflict(route):
   current=request('form-records');value={**current['data']['habits'],'2026-11-06':{'minutes':35,'note':'Other section update'}};request('form-records/sections/habits',{'base_revision':current['revision'],'value':value},'PATCH');route.continue_()
  page.route('**/form-records/sections/decisions',conflict);ws('决策').get_by_role('button',name='确认保存本栏到云端',exact=True).click();expect(ws('决策').get_by_text(re.compile('本次提交被拒绝'))).to_be_visible();page.unroute('**/form-records/sections/decisions',conflict)
  with page.expect_response(lambda r:r.request.method=='GET' and r.url.endswith('/form-records')):ws('决策').get_by_role('button',name='核对云端表单',exact=True).click()
  ws('决策').get_by_text('比较原基线、云端与本机整栏',exact=True).click();expect(ws('决策').get_by_role('region',name='本机当前内容',exact=True)).to_contain_text('Local conflict input');ws('决策').get_by_role('button',name='已核对，解除待核对状态',exact=True).click();ws('决策').get_by_role('button',name='已比较，保留本机整栏并采用云端基线',exact=True).click();save('决策');assert request('form-records')['data']['habits']['2026-11-06']['minutes']==35
  choose('自定义记录');load('自定义记录');ws('自定义记录').get_by_label('新字段名称',exact=True).fill('Synthetic date');ws('自定义记录').get_by_label('字段类型',exact=True).select_option('date');ws('自定义记录').get_by_role('button',name='添加自定义字段',exact=True).click();ws('自定义记录').get_by_role('button',name='编辑第 1 条',exact=True).click();fill('自定义记录','Synthetic date','2026-11-08');join('自定义记录');save('自定义记录');custom=request('form-records')['data'];assert custom['customRecords'][0]['f-synthetic']==0 and custom['customRecords'][0]['legacy_origin']=='Retained'
  ws('自定义记录').get_by_role('button',name='删除字段 Count',exact=True).click();save('自定义记录');assert 'f-synthetic' not in request('form-records')['data']['customRecords'][0];ws('自定义记录').get_by_role('button',name='撤回上次删除（仍需保存）',exact=True).click();save('自定义记录');assert request('form-records')['data']['customRecords'][0]['f-synthetic']==0
  ws('自定义记录').get_by_role('button',name='删除第 1 条',exact=True).click();assert len(request('form-records')['data']['customRecords'])==1;ws('自定义记录').get_by_role('button',name='撤回上次删除（仍需保存）',exact=True).click();save('自定义记录')
  choose('手工补记');load('手工补记');ws('手工补记').get_by_role('button',name='编辑第 2026-11-07 条',exact=True).click();fill('手工补记','日期','2026-11-08');ed('手工补记').get_by_role('button',name='加入本机列表',exact=True).click();expect(ws('手工补记').get_by_text('该日期已有补记，请先打开核对，不能覆盖另一日期。',exact=True)).to_be_visible();fill('手工补记','日期','2026-11-07');fill('手工补记','手工补记分钟','30');join('手工补记');save('手工补记');ws('手工补记').get_by_text('近30天手工补记时长',exact=True).click();expect(ws('手工补记').get_by_role('table')).to_contain_text('2026-11-07');assert request('form-records')['data']['habits']['2026-11-07']['minutes']==30
  choose('预测');load('预测');ws('预测').get_by_role('button',name='编辑第 1 条',exact=True).click();fill('预测','自报概率 %','');fill('预测','结果','Synthetic settled result');join('预测');save('预测');assert request('form-records')['data']['predictions'][0]['probability']==''
  choose('表单复盘');load('表单复盘');ws('表单复盘').get_by_role('button',name='新增表单复盘',exact=True).click();fill('表单复盘','原来怎么想','New review before');fill('表单复盘','下次怎么改（可操作规则）','No automatic schedule');join('表单复盘');save('表单复盘');expect(ws('表单复盘').get_by_role('complementary',name='本机表单统计',exact=True)).to_contain_text('表单复盘 2')
  choose('历史待办');load('历史待办');expect(ws('历史待办').get_by_role('button',name='新增历史待办',exact=True)).to_have_count(0);ws('历史待办').get_by_role('button',name='勾选本机历史待办',exact=True).click();assert request('form-records')['data']['todos'][0]['done'] is False;save('历史待办');todo=request('form-records')['data']['todos'][0];assert todo['done'] is True and todo['legacy_id']=='Preserve-original'
  choose('洞见');load('洞见');ws('洞见').get_by_role('button',name='新增洞见',exact=True).click();fill('洞见','来源事件','Synthetic event');fill('洞见','洞察','Offline observation');join('洞见');context.set_offline(True);ws('洞见').get_by_role('button',name='确认保存本栏到云端',exact=True).click();expect(ws('洞见').get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();context.set_offline(False);page.reload();expect(ws('洞见').get_by_role('button',name='重试原请求',exact=True)).to_be_visible();ws('洞见').get_by_role('button',name='重试原请求',exact=True).click();expect(ws('洞见').get_by_text('云端已确认。',exact=True)).to_be_visible();assert len(request('form-records')['data']['insights'])==2
  ws('洞见').get_by_role('button',name='新增洞见',exact=True).click();fill('洞见','洞察','Storage failure preserved');join('洞见');count=[];page.on('request',lambda r:count.append(r.url) if r.method=='PATCH' and '/form-records/sections/' in r.url else None)
  page.evaluate("() => {window.__formOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k).includes(':form-section-'))throw new DOMException('Synthetic quota','QuotaExceededError');return window.__formOriginalSet.call(this,k,v)};}")
  ws('洞见').get_by_role('button',name='确认保存本栏到云端',exact=True).click();expect(ws('洞见').get_by_text('无法保存原请求，本次尚未发送。',exact=True)).to_be_visible();assert count==[]
  page.evaluate('() => {Storage.prototype.setItem=window.__formOriginalSet;}');save('洞见')
  for width in [320,375,768,1440]:
   page.set_viewport_size({'width':width,'height':1000});ws('洞见').scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
   if width==375:page.screenshot(path=str(a.output/'forms-editor-375.png'))
  page.set_viewport_size({'width':1440,'height':1000});ws('洞见').scroll_into_view_if_needed();page.screenshot(path=str(a.output/'forms-editor-desktop.png'))
  with page.expect_download() as event:ws('洞见').get_by_role('button',name='下载本栏本机修改副本',exact=True).click()
  backup=json.loads(Path(event.value.path()).read_text());assert backup['draft']['section']=='insights' and len(backup['draft']['value'])==3
  after=json.loads(request('review/export')['content']);assert after['tasks']==before_core['tasks'] and after['reflections']==before_core['reflections'];assert after['form_records']['data']['decisions'][0]['probability']==0
  assert errors==[],errors
  result={'passed':True,'served_revision':a.expected_grow_revision,'browser':browser.version,'all_seven_sections_edited':True,'raw_editor_reload_and_section_navigation_preserve_input':True,'response_loss_account_switch_and_original_body_key_replay':True,'cross_section_409_explicit_three_way_review':True,'custom_zero_and_legacy_identity_preserved':True,'field_delete_and_persisted_undo':True,'habit_date_collision_refused':True,'blank_probability_remains_unknown':True,'offline_recovery':True,'storage_failure_sends_no_request':True,'native_tasks_and_reflections_unchanged':True,'widths':[320,375,768,1440],'page_errors':errors,'final_snapshot':request('form-records')}
  (a.output/'browser-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='final_snapshot'}))
 except Exception:
  page.screenshot(path=str(a.output/'failure.png'));raise
 finally:browser.close()
