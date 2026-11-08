"""Screen rule owner switching and exact pending recovery, isolated localhost identities."""
import argparse,json,uuid,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--expected-grow-revision',required=True);p.add_argument('--account',default='course11@example.com');a=p.parse_args();assert a.url.startswith('http://127.0.0.1:') and re.fullmatch(r'course\d+@example.com',a.account);a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 api=pw.request.new_context(base_url=a.url);assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text();auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':a.account,'password':'Password1234','clientType':'app'}).json()['data'];h={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'};rid='inv-screen-scope-'+uuid.uuid4().hex;label='Synthetic scoped rule '+uuid.uuid4().hex[:6];fields={'name':label,'description':'Baseline','source_text':'','conditions':[],'combine':'all','sort_by':'close','descending':True,'secondary_sort_by':None,'secondary_descending':True,'limit':20,'recipe':None,'sort_mapping':{'source':'manual','quote':'','reason':''}};endpoint='/api/v1/lighttick/investments/screening/rules/'+rid
 r=api.put(endpoint,headers={**h,'Idempotency-Key':str(uuid.uuid4())},data={'base_revision':0,'fields':fields});assert r.status==200,r.text()
 b=pw.chromium.launch(channel='chrome',headless=True);c=b.new_context();page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def login(account):
  page.get_by_label('邮箱或手机号').fill(account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();expect(page.get_by_role('button',name='退出登录',exact=True)).to_be_visible();page.goto(a.url+'/grow/investments')
 def panel():return page.get_by_role('region',name='版本化规则与筛选',exact=True)
 def editor():return page.get_by_role('region',name='筛选规则编辑',exact=True)
 try:
  page.goto(a.url+'/grow/investments');login(a.account);panel().get_by_role('button',name=label+' · 规则版本 1',exact=True).click();private='Synthetic owner pending rule';editor().get_by_label('筛选规则说明',exact=True).fill(private);pending=[]
  def lose(route):
   if route.request.method=='PUT':pending.append((route.request.post_data,route.request.headers['idempotency-key']));route.abort('failed')
   else:route.continue_()
  page.route('**/screening/rules/'+rid,lose);editor().get_by_role('button',name='保存筛选规则',exact=True).click();expect(editor().get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/screening/rules/'+rid,lose);page.get_by_role('button',name='退出登录',exact=True).click();login('course8@example.com');expect(panel().get_by_role('button',name=label+' · 规则版本 1',exact=True)).not_to_be_visible();panel().get_by_role('button',name='准备新筛选规则',exact=True).click();expect(editor().get_by_label('筛选规则说明',exact=True)).to_have_value('');expect(editor().get_by_role('button',name='重试原请求',exact=True)).not_to_be_visible();page.reload();expect(panel().get_by_role('button',name=label+' · 规则版本 1',exact=True)).not_to_be_visible()
  page.get_by_role('button',name='退出登录',exact=True).click();login(a.account);panel().get_by_role('button',name=label+' · 规则版本 1',exact=True).click();expect(editor().get_by_label('筛选规则说明',exact=True)).to_have_value(private);replay=[]
  def capture(route):
   if route.request.method=='PUT':replay.append((route.request.post_data,route.request.headers['idempotency-key']))
   route.continue_()
  page.route('**/screening/rules/'+rid,capture);editor().get_by_role('button',name='重试原请求',exact=True).click();expect(panel().get_by_role('button',name=label+' · 规则版本 2',exact=True)).to_be_visible();assert replay==pending;assert api.get(endpoint,headers=h).json()['data']['fields']['description']==private;assert not errors;editor().screenshot(path=str(a.output/'owner-recovery.png'));(a.output/'result.json').write_text(json.dumps({'passed':True,'served_revision':a.expected_grow_revision,'rule_id':rid,'switch_owner_reload_retains_exact_original_without_replay':True,'foreign_owner_no_local_or_cloud_visibility':True,'page_errors':errors},indent=2))
 except Exception:page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:api.dispose();c.close();b.close()
