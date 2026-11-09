# -*- coding: utf-8 -*-
"""Real Chrome on dedicated localhost synthetic Zook fixture; never uses real credentials."""
import argparse,json,uuid,time,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--account',default='course0@example.com');p.add_argument('--expected-grow-revision',required=True);a=p.parse_args()
assert a.url.startswith('http://127.0.0.1:') and re.fullmatch(r'course\d+@example.com',a.account)
a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True);c=b.new_context(viewport={'width':1440,'height':1000});page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 api=pw.request.new_context(base_url=a.url)
 assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text()
 auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':a.account,'password':'Password1234','clientType':'app'}).json()['data'];h={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'}
 secret='SYNTHETIC_'+uuid.uuid4().hex;root='/api/v1/lighttick/';rid='inv-research-ai-'+uuid.uuid4().hex[:12];label='AI研究合成 '+uuid.uuid4().hex[:8];code='600'+str(uuid.uuid4().int%1000).zfill(3)
 def req(path,body=None,method='GET'):
  r=api.fetch(root+path,method=method,headers={**h,'Idempotency-Key':str(uuid.uuid4())},data=body)
  assert r.status==200,r.text();return r.json()['data']
 def model(base,name):
  return req('ai/model-settings',{'base_revision':base,'mode':'personal','base_url':'https://personal-model.example.invalid/v1','model_name':name,'api_key':secret},'PUT')
 def wait_task(id):
  end=time.monotonic()+20
  while True:
   w=req('investments/research-ai/'+id)
   if w['status'] not in ['queued','running']:return w
   assert time.monotonic()<end;time.sleep(.1)
 def open_entry(title,revision):
  page.get_by_role('button',name=label+' · '+code+' · SSE',exact=True).click()
  page.get_by_role('region',name='投资研究档案').get_by_role('button',name=title+' · 修订 '+str(revision),exact=True).click()
 def submit(kind):
  v.get_by_label('研究 AI 任务类型',exact=True).select_option(kind);v.get_by_role('checkbox').check()
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/investments/research-ai')) as response:v.get_by_role('button',name='提交研究 AI 任务',exact=True).click()
  assert response.value.status==200,response.value.text();return response.value.json()['data']
 def card(id):return v.get_by_role('article',name='研究任务 '+id,exact=True)
 def adopt(id):
  w=wait_task(id);assert w['status']=='succeeded' and not w['adopted_at'];v.get_by_role('button',name='刷新研究 AI 任务',exact=True).click();row=card(id)
  expect(row.get_by_role('button',name='核对后采用为分析成果')).to_be_visible(timeout=10000)
  base=row.get_by_role('button',name='核对并采用当前任务修订',exact=True)
  if base.is_visible():base.click()
  row.get_by_role('button',name='核对后采用为分析成果',exact=True).click();expect(row).to_contain_text('已明确采用',timeout=10000)
  assert req('investments/research/'+rid)['revision']==1
  return req('investments/research-ai/'+id)
 try:
  assert req('ai/model-settings')['revision']==0,'Use a fresh synthetic account, never reset existing settings'
  model(0,'research-personal')
  assert not req('investments/accounts')['items']
  symbol=req('investments/instruments',{'market':'SSE','code':code,'kind':'stock','name':label},'POST')['instrument']
  fields=['market_context','technical_case','catalyst','company_risk','valuation_assumptions','liquidity','nav_context','portfolio_impact','contrary_case','missing_inputs']
  body={**{f:'' for f in fields},'base_revision':0,'instrument_id':symbol['id'],'account_id':None,'title':label,'horizon':'short','market_sources':[],'evidence':[{'title':'合成资料','content':'Synthetic reviewed source. No actual company data.','locator':'synthetic-page-1','source_url':None,'available_at':'2026-10-01T00:00:00Z','contrary_evidence':'Unconfirmed assumptions'}]}
  req('investments/research/'+rid,body,'PUT')
  page.goto(a.url+'/grow/investments');page.get_by_label('邮箱或手机号').fill(a.account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();open_entry(label,1)
  v=page.get_by_role('region',name='研究 AI 与报告');v.get_by_role('button',name='采用当前研究模型基线',exact=True).click();v.get_by_role('checkbox').check()
  lost=[]
  def lose(route):
   if route.request.method=='POST':
    r=route.fetch();assert r.status==200,r.text();lost.append((route.request.post_data,route.request.headers['idempotency-key'],r.json()['data']['id']));route.abort('failed')
   else:route.continue_()
  page.route('**/investments/research-ai',lose);v.get_by_role('button',name='提交研究 AI 任务',exact=True).click();expect(v.get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();assert len(lost)==1
  page.unroute('**/investments/research-ai',lose);page.reload();open_entry(label,1);replay=[]
  def capture(route):
   if route.request.method=='POST':replay.append((route.request.post_data,route.request.headers['idempotency-key']))
   route.continue_()
  page.route('**/investments/research-ai',capture);v.get_by_role('button',name='重试原请求',exact=True).click();expect(v.get_by_role('button',name='重试原请求',exact=True)).not_to_be_visible();assert replay==[(lost[0][0],lost[0][1])];page.unroute('**/investments/research-ai',capture)
  adopted=[adopt(lost[0][2])]
  for kind in ['guide','report']:
   w=submit(kind);adopted.append(adopt(w['id']));assert kind in adopted[-1]['output']['text'];assert adopted[-1]['output']['model']=='research-personal'
  assert not page.evaluate('(s)=>JSON.stringify(localStorage).includes(s)||JSON.stringify(sessionStorage).includes(s)',secret)
  model(1,'synthetic-slow');v.get_by_role('button',name='核对研究模型设置',exact=True).click();expect(v.get_by_text(re.compile('^云端模型.*修订 2'))).to_be_visible();v.get_by_role('button',name='采用当前研究模型基线',exact=True).click()
  slow=submit('analysis');row=card(slow['id']);expect(row).to_contain_text('生成中',timeout=10000);base=row.get_by_role('button',name='核对并采用当前任务修订',exact=True)
  if base.is_visible():base.click()
  row.get_by_role('button',name='取消研究任务',exact=True).click();assert wait_task(slow['id'])['status']=='cancelled'
  model(2,'synthetic-failed');v.get_by_role('button',name='核对研究模型设置',exact=True).click();expect(v.get_by_text(re.compile('^云端模型.*修订 3'))).to_be_visible();v.get_by_role('button',name='采用当前研究模型基线',exact=True).click()
  failed=submit('report');assert wait_task(failed['id'])['status']=='failed';assert req('investments/research-ai/'+failed['id'])['output'] is None
  model(3,'synthetic-slow');v.get_by_role('button',name='核对研究模型设置',exact=True).click();expect(v.get_by_text(re.compile('^云端模型.*修订 4'))).to_be_visible();v.get_by_role('button',name='采用当前研究模型基线',exact=True).click()
  stale=submit('guide');expect(card(stale['id'])).to_contain_text('生成中',timeout=10000)
  changed={**body,'base_revision':1,'title':label+' 新版'};req('investments/research/'+rid,changed,'PUT')
  terminal=wait_task(stale['id']);assert terminal['status']=='failed' and terminal['output'] is None
  stale_adopt=api.post(root+'investments/research-ai/'+stale['id']+'/adopt',headers={**h,'Idempotency-Key':str(uuid.uuid4())},data={'base_revision':terminal['revision']});assert stale_adopt.status==409
  page.reload();open_entry(label+' 新版',2);v.get_by_role('button',name='核对并使用当前档案修订',exact=True).click()
  stale_model=submit('analysis');expect(card(stale_model['id'])).to_contain_text('生成中',timeout=10000)
  req('ai/model-settings',{'base_revision':4,'mode':'platform','base_url':None,'model_name':None,'api_key':None},'PUT')
  terminal=wait_task(stale_model['id']);assert terminal['status']=='failed' and terminal['output'] is None
  extra=req('investments/research-ai',{'research_id':rid,'base_revision':2,'kind':'report','consent':True,'model_mode':'platform','model_revision':5},'POST');assert wait_task(extra['id'])['status']=='succeeded'
  v.get_by_role('button',name='核对研究模型设置',exact=True).click();expect(v.get_by_text(re.compile('^云端模型.*修订 5'))).to_be_visible();v.get_by_role('button',name='采用当前研究模型基线',exact=True).click()
  v.get_by_label('研究 AI 任务类型',exact=True).select_option('guide');v.get_by_role('checkbox').check();v.get_by_role('button',name='提交研究 AI 任务',exact=True).click()
  expect(v.get_by_role('button',name='已核对，解除待核对状态',exact=True)).to_be_visible()
  assert len(req('investments/research-ai?research_id='+rid)['items'])==8
  v.get_by_role('button',name='已核对，解除待核对状态',exact=True).click();expect(v.get_by_label('研究 AI 任务类型',exact=True)).to_be_enabled();expect(v.get_by_label('研究 AI 任务类型',exact=True)).to_have_value('guide')
  exported=req('review/export');serialized=json.dumps(exported);assert secret not in serialized
  assert all(req('investments/research-ai/'+w['id'])['adopted_at'] for w in adopted)
  assert req('investments/research/'+rid)['revision']==2 and not req('investments/accounts')['items']
  v.get_by_role('button',name='刷新研究 AI 任务',exact=True).click();page.screenshot(path=str(a.output/'research-ai-desktop.png'),full_page=True)
  for width in [320,375,768,1024]:
   page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  page.set_viewport_size({'width':320,'height':900});v.scroll_into_view_if_needed();page.screenshot(path=str(a.output/'research-ai-320.png'))
  assert errors==[],errors
  (a.output/'result.json').write_text(json.dumps({'passed':True,'served_revision':a.expected_grow_revision,'research_id':rid,'account':a.account,'lost_response_exact_original_after_reload':True,'analysis_guide_report_explicit_adoption':True,'selected_personal_model_used':True,'no_account_required':True,'cancel_fences_late_results':True,'provider_failure_no_fallback':True,'source_change_refuses_result_and_adoption':True,'model_change_refuses_result':True,'original_facts_not_automatically_modified':True,'export_no_secret':True,'quota_refusal_keeps_draft_and_explicit_release':True,'no_browser_secret':True,'widths':[320,375,768,1024],'page_errors':errors},indent=2))
 except Exception:page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:page.close(run_before_unload=False);api.dispose();b.close()
 if (a.output/'result.json').exists():
  result=json.loads((a.output/'result.json').read_text());result['browser_cleanup_completed']=True;(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print('GSTACK_STEP_OK',flush=True)
