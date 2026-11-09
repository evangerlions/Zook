# -*- coding: utf-8 -*-
"""Scoped source and account-switch recovery using isolated localhost synthetic users."""
import argparse,json,uuid,re,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--account',default='course9@example.com');p.add_argument('--expected-grow-revision',required=True);a=p.parse_args();assert a.url.startswith('http://127.0.0.1:') and re.fullmatch(r'course\d+@example.com',a.account);a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 api=pw.request.new_context(base_url=a.url)
 deadline=time.monotonic()+20
 while True:
  try:
   ready=api.get('/grow/runtime-config.js');assert ready.status==200 and a.expected_grow_revision in ready.text();break
  except Exception:
   if time.monotonic()>=deadline:raise
   time.sleep(.2)
 auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':a.account,'password':'Password1234','clientType':'app'}).json()['data'];h={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'};root='/api/v1/lighttick/investments/';label='Scoped synthetic source '+uuid.uuid4().hex[:8]
 def req(path,body=None,method='GET'):
  r=api.fetch(root+path,headers={**h,'Idempotency-Key':str(uuid.uuid4())},method=method,data=body);assert r.status==200,r.text();return r.json()['data']
 assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text();instruments=[]
 for n in range(2):instruments.append(req('instruments',{'market':'SSE','code':'600'+str(uuid.uuid4().int%1000).zfill(3),'kind':'stock','name':'Scoped symbol '+uuid.uuid4().hex[:8]},'POST')['instrument'])
 aid='inv-scope-account-'+uuid.uuid4().hex;account=req('accounts/'+aid,{'base_revision':0,'name':'Synthetic scope account '+uuid.uuid4().hex[:8],'currency':'CNY','baseline_date':'2026-10-01','opening_cash':'0','opening_positions':[]},'PUT')
 fields=['market_context','technical_case','catalyst','company_risk','valuation_assumptions','liquidity','nav_context','portfolio_impact','contrary_case','missing_inputs'];dossiers=[]
 for n in range(2):
  rid='inv-scoped-research-'+uuid.uuid4().hex;rb={**{f:'' for f in fields},'base_revision':0,'instrument_id':instruments[1-n]['id'],'account_id':aid if n else None,'title':'Scoped dossier '+uuid.uuid4().hex[:8],'horizon':'short','evidence':[],'market_sources':[]};req('research/'+rid,rb,'PUT');dossiers.append((rid,rb))
 b=pw.chromium.launch(channel='chrome',headless=True);c=b.new_context(viewport={'width':1440,'height':1000});page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def login(account):
  page.get_by_label('邮箱或手机号').fill(account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();expect(page.get_by_role('button',name='退出登录',exact=True)).to_be_visible();page.goto(a.url+'/grow/investments')
 def library():return page.get_by_role('region',name='独立研究资料库',exact=True)
 def editor():return page.get_by_role('region',name='独立资料编辑',exact=True)
 def open_research(n):
  i=instruments[1-n];page.get_by_role('button',name=i['name']+' · '+i['code']+' · SSE',exact=True).click();page.get_by_role('region',name='投资研究档案',exact=True).get_by_role('button',name=dossiers[n][1]['title']+' · 修订 1',exact=True).click();return page.get_by_role('region',name='研究档案编辑',exact=True)
 def pin(r):
  picker=r.get_by_role('region',name='研究独立资料引用',exact=True);picker.get_by_role('button',name='读取可引用资料列表',exact=True).click();expect(picker.get_by_label('选择独立资料',exact=True).get_by_role('option',name=label+' · 当前版本 1',exact=True)).to_be_attached();picker.get_by_label('选择独立资料',exact=True).select_option(mid);picker.get_by_role('button',name='读取并核对资料版本',exact=True).click();expect(picker.get_by_role('article',name='资料版本 '+mid+' 1',exact=True)).to_contain_text('2026-09-30');picker.get_by_role('button',name='采用此资料版本供研究引用',exact=True).click()
 try:
  page.goto(a.url+'/grow/investments');login(a.account);library().get_by_role('button',name='准备新独立资料',exact=True).click();e=editor();e.get_by_label('独立资料标题',exact=True).fill(label);e.get_by_label('独立资料原文',exact=True).fill('Scoped source original');e.get_by_label('独立资料可获知时间（含时区）',exact=True).fill('2026-10-01T00:00:00Z');e.get_by_label('资料覆盖截止日（可选）',exact=True).fill('2026-09-30');e.get_by_label('资料所属标的（可选）',exact=True).select_option(instruments[0]['id']);e.get_by_label('资料所属账户（可选）',exact=True).select_option(aid)
  with page.expect_response(lambda r:r.request.method=='PUT' and '/investments/materials/' in r.url) as saved:e.get_by_role('button',name='保存独立资料',exact=True).click()
  assert saved.value.status==200,saved.value.text();m=saved.value.json()['data'];mid=m['id'];assert m['instrument_id']==instruments[0]['id'] and m['account_id']==aid and m['period_end']=='2026-09-30'
  r=open_research(0);pin(r)
  for match_account in [False,True]:
   if match_account:r.get_by_label('关联资产账户（可选）',exact=True).select_option(aid)
   with page.expect_response(lambda res:res.request.method=='PUT' and res.url.endswith('/research/'+dossiers[0][0])) as refused:r.get_by_role('button',name='保存研究档案',exact=True).click()
   assert refused.value.status==422;expect(r.get_by_role('button',name='已核对，解除待核对状态',exact=True)).to_be_visible();assert not req('research/'+dossiers[0][0]).get('material_sources');r.get_by_role('button',name='已核对，解除待核对状态',exact=True).click()
  r=open_research(1);pin(r);r.get_by_role('button',name='保存研究档案',exact=True).click();expect(page.get_by_role('region',name='投资研究档案',exact=True).get_by_role('button',name=dossiers[1][1]['title']+' · 修订 2',exact=True)).to_be_visible();assert req('research/'+dossiers[1][0])['material_sources'][0]['id']==mid
  e=editor();private='Synthetic owner A pending material';e.get_by_label('独立资料原文',exact=True).fill(private);pending=[]
  def lose(route):
   if route.request.method=='PUT':pending.append((route.request.post_data,route.request.headers['idempotency-key']));route.abort('failed')
   else:route.continue_()
  page.route('**/investments/materials/'+mid,lose);e.get_by_role('button',name='保存独立资料',exact=True).click();expect(e.get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();assert len(pending)==1;page.unroute('**/investments/materials/'+mid,lose);page.get_by_role('button',name='退出登录',exact=True).click();login('course4@example.com');expect(library().get_by_role('button',name=label+' · 资料版本 1',exact=True)).not_to_be_visible();library().get_by_role('button',name='准备新独立资料',exact=True).click();expect(editor().get_by_label('独立资料标题',exact=True)).to_have_value('');expect(editor().get_by_role('button',name='重试原请求',exact=True)).not_to_be_visible();assert req('materials/'+mid)['revision']==1
  page.get_by_role('button',name='退出登录',exact=True).click();login(a.account);library().get_by_role('button',name=label+' · 资料版本 1',exact=True).click();e=editor();expect(e.get_by_label('独立资料原文',exact=True)).to_have_value(private);expect(e.get_by_label('资料覆盖截止日（可选）',exact=True)).to_have_value('2026-09-30');replay=[]
  def capture(route):
   if route.request.method=='PUT':replay.append((route.request.post_data,route.request.headers['idempotency-key']))
   route.continue_()
  page.route('**/investments/materials/'+mid,capture);e.get_by_role('button',name='重试原请求',exact=True).click();expect(library().get_by_role('button',name=label+' · 资料版本 2',exact=True)).to_be_visible();assert replay==pending;assert req('materials/'+mid)['content']==private;assert req('materials/'+mid)['account_id']==aid;assert not errors;e.screenshot(path=str(a.output/'scope-and-owner-recovery.png'));(a.output/'result.json').write_text(json.dumps({'passed':True,'served_revision':a.expected_grow_revision,'optional_scope_and_period_end_roundtrip':True,'account_and_instrument_mismatch_refused_without_fact':True,'matching_scope_reference_accepted':True,'switch_owner_retains_exact_original_without_replay':True,'material_id':mid,'synthetic_account':a.account,'page_errors':errors},indent=2))
 except Exception:page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:api.dispose();c.close();b.close()
